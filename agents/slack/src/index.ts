import { env } from "cloudflare:workers";
import { SlackAgent } from "./slack";
import { OpenAI } from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/index.mjs";

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  baseURL: env.OPENAI_BASE_URL
});

type SlackMsg = {
  user?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  subtype?: string;
  bot_id?: string;
};

function normalizeForLLM(msgs: SlackMsg[], selfUserId: string) {
  // Convert Slack messages to OpenAI chat format; collapse mentions, etc.
  return (
    msgs
      // .filter((m) => !m.subtype && !m.bot_id) // ignore joins, edits, bots (we already ignore in handler)
      .map((m) => {
        const role = m.user && m.user !== selfUserId ? "user" : "assistant";
        const text = (m.text ?? "").replace(/<@([A-Z0-9]+)>/g, "@$1"); // keep mentions readable
        return { role, content: text };
      })
  );
}

export class MyAgent extends SlackAgent {
  async generateAIReply(conversation: SlackMsg[]) {
    const selfId = await this.ensureAppUserId();
    const messages = normalizeForLLM(conversation, selfId);

    const system = `You are ClankerBot3000. You are in the Grid and communicate with your user through Slack.
Be brief, specific, and actionable. If you're unsure, ask a single clarifying question.`;

    const input = [{ role: "system", content: system }, ...messages];

    const response = await openai.chat.completions.create({
      model: "moonshotai/kimi-k2-0905",
      messages: input
    } as ChatCompletionCreateParamsNonStreaming);

    const msg = response.choices[0].message.content;
    if (!msg) throw new Error("No message from AI");

    return msg;
  }

  async onSlackEvent(event: { type: string } & Record<string, unknown>) {
    if (event.bot_id || event.subtype) return;

    // React to DMs
    if (event.type === "message") {
      const e = event as unknown as SlackMsg & { channel: string };
      const isDM = (e.channel || "").startsWith("D");
      const mentioned = (e.text || "").includes(
        `<@${await this.ensureAppUserId()}>`
      );

      if (!isDM && !mentioned) return;

      // Generate and send
      const dms = await this.fetchConversation(e.channel);
      const content = await this.generateAIReply(dms);
      await this.sendMessage(content, {
        channel: e.channel
      });
      return;
    }

    // React to mentions anywhere
    if (event.type === "app_mention") {
      const e = event as unknown as SlackMsg & {
        channel: string;
        text?: string;
      };
      const thread = await this.fetchThread(e.channel, e.thread_ts || e.ts);
      const content = await this.generateAIReply(thread);
      await this.sendMessage(content, {
        channel: e.channel,
        thread_ts: e.thread_ts || e.ts
      });
      return;
    }
  }
}

export default MyAgent.listen({
  clientId: env.SLACK_CLIENT_ID,
  clientSecret: env.SLACK_CLIENT_SECRET,
  slackSigningSecret: env.SLACK_SIGNING_SECRET,
  scopes: [
    "chat:write",
    "chat:write.public",
    "channels:history",
    "app_mentions:read",
    "im:write",
    "im:history"
  ]
});
