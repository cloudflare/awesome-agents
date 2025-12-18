import { getAgentByName } from "agents";
import { DurableObject } from "cloudflare:workers";
import { PersistedObject } from "../persisted";
import { discordFetch } from "../utils";
import type { DiscordChannel, DiscordMessage } from "./types";

const GATEWAY_ENDPOINT = "https://discord.com/api/v10/gateway";
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

type State = {
  seq: number;
};

export class DiscordGateway extends DurableObject<Env> {
  heartbeatInterval = 0;
  ws: WebSocket | null = null;
  private readonly state;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = PersistedObject<State>(state.storage.kv, { prefix: "state_" });
  }

  async alarm() {
    await this.heartbeat();
  }

  async start() {
    console.log("starting discord gateway");
    if (this.ws) {
      console.log("WebSocket connection already exists, skipping start...");
      return;
    }

    // get gateway url
    const gatewayResp = await fetch(GATEWAY_ENDPOINT);
    const { url } = await gatewayResp.json<{ url: string }>();
    const asUrl = new URL(url);

    // open ws connection with discord gateway
    const resp = await fetch(`https://${asUrl.host}?v=10&encoding=json`, {
      headers: {
        Upgrade: "websocket",
        Authorization: `Bot ${BOT_TOKEN}`
      }
    });
    const ws = resp.webSocket;
    if (!ws) throw "Error, ws was empty";
    ws?.accept();

    // setup event handlers
    ws.addEventListener(
      "message",
      async (e) => await this.handleMessage(e.data)
    );
    ws.addEventListener("close", () => this.handleClose());
    ws.addEventListener("error", console.error);
    this.ws = ws;
  }

  async handleMessage(rawData: any) {
    if (!this.ws) throw Error("Received msg when no ws is set?");
    const payload = JSON.parse(rawData);
    const { op, t, d, s } = payload;

    // Track sequence for resuming and heartbeats
    if (s !== null) this.state.seq = s;

    switch (op) {
      case 10: // Hello
        this.heartbeatInterval = d.heartbeat_interval;
        this.heartbeat();
        this.identify();
        break;

      case 0: // Dispatch
        await this.onDispatch(t, d);
        break;

      case 11: // Heartbeat ACK
        break;
    }
  }

  private identify() {
    const INTENTS = {
      GUILDS: 1 << 0,
      GUILD_MESSAGES: 1 << 9,
      DIRECT_MESSAGES: 1 << 12,
      MESSAGE_CONTENT: 1 << 15
    };
    const intents =
      INTENTS.GUILDS |
      INTENTS.GUILD_MESSAGES |
      INTENTS.DIRECT_MESSAGES |
      INTENTS.MESSAGE_CONTENT;
    this.ws?.send(
      JSON.stringify({
        op: 2,
        d: {
          token: BOT_TOKEN,
          intents,
          properties: { os: "cf", browser: "cf", device: "cf" }
        }
      })
    );
  }

  private async onDispatch(t: string, d: any) {
    if (t === "MESSAGE_CREATE" && !d.author?.bot && !!d.content) {
      const botId = this.env.DISCORD_APPLICATION_ID;

      if (!d.guild_id) {
        // DM
        const agent = await getAgentByName(this.env.AGENT, `dm:${d.author.id}`);
        await agent.onDmMessage({
          channelId: d.channel_id,
          authorId: d.author.id,
          content: d.content || "",
          id: d.id
        });
        return;
      }

      // Guild: check if mentioned or in a bot-started thread
      const mentioned =
        Array.isArray(d.mentions) &&
        d.mentions.some((m: any) => m.id === botId);

      const inBotThread = await this.isInBotStartedThread(d.channel_id, botId);

      if (!mentioned && !inBotThread) return;

      const agentName = `guild:${d.guild_id}`;
      console.log(
        `[Gateway] Routing to agent: ${agentName}, channel: ${d.channel_id}`
      );
      const agent = await getAgentByName(this.env.AGENT, agentName);
      await agent.onGuildMessage({
        guildId: d.guild_id,
        channelId: d.channel_id,
        authorId: d.author.id,
        content: d.content ?? "",
        id: d.id
      });
    }
  }

  private async isInBotStartedThread(
    channelId: string,
    botId: string
  ): Promise<boolean> {
    try {
      // Fetch channel info to check if it's a thread
      const channelRes = await discordFetch(`/channels/${channelId}`, {
        method: "GET",
        botToken: this.env.DISCORD_BOT_TOKEN
      });

      if (!channelRes.ok) return false;

      const channel = await channelRes.json<DiscordChannel>();

      // Channel types: 11 = public thread, 12 = private thread, 10 = announcement thread
      const isThread = [10, 11, 12].includes(channel.type);
      if (!isThread) return false;

      // Check if thread has a starter message created by the bot
      // Threads created from messages have the original message as the starter
      if (channel.owner_id === botId) return true;

      // Alternatively, fetch the starter message if available
      const starterMessageId = channel.id; // In Discord, the thread ID is the same as the starter message ID
      const messageRes = await discordFetch(
        `/channels/${channel.parent_id}/messages/${starterMessageId}`,
        {
          method: "GET",
          botToken: this.env.DISCORD_BOT_TOKEN
        }
      );

      if (!messageRes.ok) return false;

      const message = await messageRes.json<DiscordMessage>();
      return message.author.id === botId;
    } catch (error) {
      console.error("Error checking thread ownership:", error);
      return false;
    }
  }

  private async heartbeat() {
    if (this.ws) {
      const msg = JSON.stringify({
        op: 1,
        d: this.state.seq ?? 0
      });
      this.ws.send(msg);
      await this.ctx.storage.setAlarm(Date.now() + this.heartbeatInterval);
    }
  }

  async handleClose() {
    console.log("closed");
    this.ws = null;
    await this.start();
  }
}
