import { Agent, getAgentByName } from "agents";
import { PersistedObject } from "../persisted";
import { DISCORD_API, discordFetch } from "../utils";
import type {
  DiscordMessage,
  DiscordChannel,
  Interaction,
  MessageParams,
  Info
} from "./types";

export type {
  DiscordMessage,
  DiscordChannel,
  Interaction,
  MessageParams,
  Info
};

export class DiscordAgent extends Agent {
  readonly info: Info;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const kv = ctx.storage.kv;
    this.info = PersistedObject<Info>(kv, { prefix: "info_" });
  }

  async onInteraction(_i: Interaction): Promise<MessageParams | string> {
    throw new Error(
      "Received Discord interaction but you didn't override onInteraction"
    );
  }

  async onDmMessage(_msg: {
    channelId: string;
    authorId: string;
    content: string;
    id: string;
  }): Promise<void> {
    throw new Error("onDmMessage not implemented");
  }

  async ensureDmChannel(): Promise<string> {
    if (this.info.dmChannel) return this.info.dmChannel;
    const res = await discordFetch(`/users/@me/channels`, {
      method: "POST",
      botToken: this.env.DISCORD_BOT_TOKEN,
      body: JSON.stringify({ recipient_id: this.info.userId })
    });
    if (!res.ok)
      throw new Error(`Failed to open DM: ${res.status} ${await res.text()}`);
    const json = await res.json<{ id: string }>();
    this.info.dmChannel = json.id;
    return json.id;
  }

  async sendDm(msg: string) {
    const channelId = await this.ensureDmChannel();
    const chunks = this.splitMessageByNewline(msg, 2000);
    for (const chunk of chunks) {
      await this.sendChannelMessage(channelId, chunk);
    }
  }

  async onGuildMessage(_msg: {
    guildId: string;
    channelId: string;
    authorId: string;
    content: string;
    id: string;
  }): Promise<void> {
    throw new Error("onGuildMessage not implemented");
  }

  protected async sendChannelMessage(
    channelId: string,
    msg: MessageParams | string
  ) {
    const body: MessageParams =
      typeof msg === "string" ? { content: msg } : msg;
    const res = await discordFetch(`/channels/${channelId}/messages`, {
      method: "POST",
      botToken: this.env.DISCORD_BOT_TOKEN,
      body: JSON.stringify(body)
    });
    if (!res.ok)
      console.error("Discord API HTTP", res.status, await res.text());
  }

  async fetchChannelMessages(
    channelId: string,
    opts: {
      limit?: number;
      before?: string;
      after?: string;
      around?: string;
    } = {}
  ): Promise<DiscordMessage[]> {
    const qs = new URLSearchParams();
    if (opts.limit) qs.set("limit", String(opts.limit));
    if (opts.before) qs.set("before", opts.before);
    if (opts.after) qs.set("after", opts.after);
    if (opts.around) qs.set("around", opts.around);
    const res = await discordFetch(`/channels/${channelId}/messages?${qs}`, {
      method: "GET",
      botToken: this.env.DISCORD_BOT_TOKEN
    });
    if (!res.ok) throw new Error("Failed to read messages");
    return res.json<DiscordMessage[]>();
  }

  async sendFollowup(interactionToken: string, msg: MessageParams | string) {
    const body: MessageParams =
      typeof msg === "string" ? { content: msg } : msg;
    const res = await fetch(
      `${DISCORD_API}/webhooks/${this.env.DISCORD_APPLICATION_ID}/${interactionToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body)
      }
    );
    if (!res.ok)
      console.error("Discord followup HTTP", res.status, await res.text());
  }

  // because discord messages have a 2k char limit and llms like to go long sometimes
  private splitMessageByNewline(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Find the last newline before maxLength
      let splitIndex = remaining.lastIndexOf("\n", maxLength);

      // If no newline found, try to split at last space
      if (splitIndex === -1 || splitIndex === 0) {
        splitIndex = remaining.lastIndexOf(" ", maxLength);
      }

      // If still no good split point, just split at maxLength
      if (splitIndex === -1 || splitIndex === 0) {
        splitIndex = maxLength;
      }

      chunks.push(remaining.substring(0, splitIndex));
      remaining = remaining.substring(splitIndex + 1); // +1 to skip the newline/space
    }

    return chunks;
  }
}
