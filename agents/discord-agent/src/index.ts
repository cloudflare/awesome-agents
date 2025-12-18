import { DiscordAgent } from "./discord/agent";
import type { DiscordMessage } from "./discord/agent";
import {
  DEFAULT_DM_BLOCKS,
  DEFAULT_GUILD_BLOCKS,
  SYSTEM_INSTRUCTIONS,
  MESSAGE_BUFFER_CONFIG,
  SUMMARY_PROMPT
} from "./constants";
import { PersistedObject } from "./persisted";
import { callLlm, Memory, type MemoryBlockI } from "./utils";
import { callTool, tools } from "./tools";

type ChannelCheckpoint = {
  oldestSeenMessageId?: string; // Oldest message we've processed (everything before this is summarized)
  summary?: string; // Summary of all messages before oldestSeenMessageId
};

type MemoryState = {
  system: string;
  blocks: MemoryBlockI[];
  messageBuffer: string[]; // Array of message IDs in the current context window
  channelCheckpoints?: Record<string, ChannelCheckpoint>; // Per-channel checkpoints
};

export class MyAgent extends DiscordAgent {
  readonly memory: MemoryState;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const { kv, sql } = ctx.storage;
    this.memory = PersistedObject<MemoryState>(kv, { prefix: "memory_" });

    if (!this.memory.channelCheckpoints) {
      this.memory.channelCheckpoints = {};
    }

    sql.exec(
      "CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, role TEXT NOT NULL, content TEXT, tool_calls TEXT, tool_call_id TEXT)"
    );
  }

  // First time booting up for a DM
  async dmOnBoot(userId: string) {
    this.info.userId = userId;
    if (!this.memory.system) {
      this.memory.system = SYSTEM_INSTRUCTIONS;
    }

    if (!this.memory.blocks || this.memory.blocks.length === 0) {
      this.memory.blocks = DEFAULT_DM_BLOCKS;
    }

    if (!this.memory.messageBuffer) {
      this.memory.messageBuffer = [];
    }
  }

  // First time booting up for a DM
  async guildOnBoot(guildId: string) {
    this.info.guildId = guildId;
    if (!this.memory.system) {
      this.memory.system = SYSTEM_INSTRUCTIONS;
    }

    if (!this.memory.blocks || this.memory.blocks.length === 0) {
      this.memory.blocks = DEFAULT_GUILD_BLOCKS;
    }

    if (!this.memory.messageBuffer) {
      this.memory.messageBuffer = [];
    }
  }
  // Helper method to add a message to SQLite and buffer
  private addMessage(message: {
    id: string;
    role: "user" | "assistant" | "tool";
    content?: string;
    tool_calls?: any[];
    tool_call_id?: string;
  }) {
    const { sql } = this.ctx.storage;
    sql.exec(
      "INSERT OR REPLACE INTO messages (id, role, content, tool_calls, tool_call_id) VALUES (?, ?, ?, ?, ?)",
      message.id,
      message.role,
      message.content ?? null,
      message.tool_calls ? JSON.stringify(message.tool_calls) : null,
      message.tool_call_id ?? null
    );
    // Add to message buffer (current context window)
    this.memory.messageBuffer = [...this.memory.messageBuffer, message.id];
  }

  // Helper method to get messages from the current context window
  private async getMessages() {
    const { sql } = this.ctx.storage;

    if (this.memory.messageBuffer.length === 0) {
      return [];
    }

    // Get messages by IDs in the buffer
    const placeholders = this.memory.messageBuffer.map(() => "?").join(",");
    const cursor = sql.exec(
      `SELECT * FROM messages WHERE id IN (${placeholders})`,
      ...this.memory.messageBuffer
    );

    // Build a map of messages by ID
    const messageMap = new Map<string, any>();
    for (const row of cursor) {
      const message: any = {
        role: row.role
      };

      if (row.content) {
        message.content = row.content;
      }

      if (row.tool_calls) {
        message.tool_calls = JSON.parse(row.tool_calls as string);
      }

      if (row.tool_call_id) {
        message.tool_call_id = row.tool_call_id;
      }

      messageMap.set(row.id as string, message);
    }

    // Return messages in buffer order
    return this.memory.messageBuffer
      .map((id) => messageMap.get(id))
      .filter((msg) => msg !== undefined);
  }

  // Summarize old messages and implement rolling window
  private async summarizeAndPruneMessages() {
    const bufferSize = this.memory.messageBuffer.length;

    if (bufferSize <= MESSAGE_BUFFER_CONFIG.MAX_MESSAGES) {
      return; // No need to prune
    }

    // Calculate how many messages to remove from buffer
    const numToRemove = Math.floor(
      bufferSize * MESSAGE_BUFFER_CONFIG.PRUNE_PERCENTAGE
    );
    const numToKeep = bufferSize - numToRemove;

    // Get IDs to summarize and IDs to keep
    const idsToSummarize = this.memory.messageBuffer.slice(0, numToRemove);
    const idsToKeep = this.memory.messageBuffer.slice(numToRemove);

    // Get the messages to summarize from DB
    const { sql } = this.ctx.storage;
    const placeholders = idsToSummarize.map(() => "?").join(",");
    const cursor = sql.exec(
      `SELECT * FROM messages WHERE id IN (${placeholders})`,
      ...idsToSummarize
    );

    // Build conversation history for summarization (in order)
    const messageMap = new Map<string, any>();
    for (const row of cursor) {
      const message: any = { role: row.role };
      if (row.content) message.content = row.content;
      if (row.tool_calls)
        message.tool_calls = JSON.parse(row.tool_calls as string);
      if (row.tool_call_id) message.tool_call_id = row.tool_call_id;
      messageMap.set(row.id as string, message);
    }

    // Get messages in buffer order
    const messagesToSummarize = idsToSummarize
      .map((id) => messageMap.get(id))
      .filter((msg) => msg !== undefined);

    // Call LLM to summarize the conversation
    const message: any = await callLlm({
      model: "moonshotai/kimi-k2-0905",
      messages: [
        {
          role: "system",
          content: SUMMARY_PROMPT
        },
        {
          role: "user",
          content: `Conversation to summarize:\n${JSON.stringify(messagesToSummarize, null, 2)}`
        }
      ],
      provider: { only: ["groq"] },
      tools: tools
    });

    const summary = message.content;

    // Create a summary message and add to DB
    const summaryMessageId = `${MESSAGE_BUFFER_CONFIG.SUMMARY_MESSAGE_ID_PREFIX}${Date.now()}`;
    const summaryMessage = `The following is a summary of the previous messages:\n${summary}`;

    const { sql: sqlWrite } = this.ctx.storage;
    sqlWrite.exec(
      "INSERT OR REPLACE INTO messages (id, role, content, tool_calls, tool_call_id) VALUES (?, ?, ?, ?, ?)",
      summaryMessageId,
      "user",
      summaryMessage,
      null,
      null
    );

    // Update buffer: [summaryId, ...remainingIds]
    this.memory.messageBuffer = [summaryMessageId, ...idsToKeep];

    console.log(
      `Summarized ${numToRemove} messages, kept ${numToKeep} messages`
    );
  }

  async onDmMessage(msg: {
    channelId: string;
    authorId: string;
    content: string;
    id: string;
  }) {
    if (!this.info.userId) this.dmOnBoot(msg.authorId);
    if (msg.content.startsWith("!")) {
      const [cmd, args] = msg.content.split(" ", 2);
      if (cmd === "!block") {
        const block = this.memory.blocks.find((b) => b.label === args);
        this.sendDm(
          `\`\`\`\n${block?.value.replaceAll("```", "\`\`\`")}\n\`\`\``
        );
        return;
      }

      if (cmd === "!messages") {
        const messages = await this.getMessages();
        this.sendDm(JSON.stringify(messages, null, 2));
        return;
      }
      return;
    }
    const reply: string = await this.doSomethingSmart(msg.content);

    // Split reply into chunks if it exceeds Discord's 4000 character limit
    await this.sendDm(reply);
  }

  async onGuildMessage(msg: {
    guildId: string;
    channelId: string; // thread id if in a thread
    authorId: string;
    content: string;
    id: string;
    mentions?: any[];
  }) {
    if (!this.info.guildId) this.guildOnBoot(msg.guildId);
    console.log(
      `[Agent] Guild: ${msg.guildId}, Channel: ${msg.channelId}, Memory blocks: ${this.memory.blocks.length}`
    );
    console.log(this.memory.blocks.map((b) => b.value));
    // Build stateless context from Discord
    const ctx = await this.buildContextFromDiscord(msg.channelId);

    // Compile system with your existing memory blocks (guild-wide)
    let systemPrompt = this.memory.system;
    const memory = new Memory(this.memory.blocks, []);
    systemPrompt += memory.compile();

    // Turn Discord history into chat turns
    const turns = this.toChatHistory(ctx.recentMessages);

    // Prepend summary if exists
    if (ctx.summary) {
      turns.unshift({
        role: "user",
        content: `[Earlier conversation summary]:\n${ctx.summary}`
      });
    }

    // Add the current user prompt
    turns.push({ role: "user", content: msg.content });
    const messages: any = [{ role: "system", content: systemPrompt }, ...turns];

    while (true) {
      // Call LLM (no guild logs stored in your DO)
      const message: any = await callLlm({
        model: "moonshotai/kimi-k2-0905",
        messages,
        provider: { only: ["groq"] },
        tools
      });

      // Handle tool calls
      if (message.tool_calls && message.tool_calls.length > 0) {
        // Add assistant message with tool calls
        messages.push({
          role: "assistant",
          tool_calls: message.tool_calls
        });

        // Execute tools and add results
        for (const toolCall of message.tool_calls) {
          const response = await callTool(
            toolCall.function.name,
            JSON.parse(toolCall.function.arguments)
          );

          // Add tool result message
          messages.push({
            role: "tool",
            content:
              typeof response === "string"
                ? response
                : JSON.stringify(response),
            tool_call_id: toolCall.id
          });
        }
        continue;
      }

      const content = message.content;
      await this.sendChannelMessage(msg.channelId, content);
      break;
    }
  }

  // Convert Discord messages to chat format by author
  private toChatHistory(msgs: DiscordMessage[]) {
    const botId = this.env.DISCORD_APPLICATION_ID;
    // Oldest first
    const sorted = [...msgs].sort((a, b) =>
      BigInt(a.id) < BigInt(b.id) ? -1 : 1
    );
    return sorted.map((m) => ({
      role: m.author.id === botId ? ("assistant" as const) : ("user" as const),
      content:
        m.author.id === botId
          ? m.content || ""
          : `[User: ${m.author.id}] ${m.content || ""}`
    }));
  }

  private async buildContextFromDiscord(channelId: string) {
    const checkpoint = this.memory.channelCheckpoints![channelId] || {};

    // Fetch most recent 100 messages
    const recentMessages = await this.fetchChannelMessages(channelId, {
      limit: 100
    });

    if (recentMessages.length === 0) {
      return { summary: checkpoint.summary || "", recentMessages: [] };
    }

    // Find oldest message in what we just fetched
    const oldestRecent = recentMessages.reduce((oldest, msg) =>
      BigInt(msg.id) < BigInt(oldest.id) ? msg : oldest
    );

    // If we got 100 messages AND we haven't seen the oldest one before,
    // it means there are MORE messages we haven't processed
    const needsSummarization =
      recentMessages.length === 100 &&
      (!checkpoint.oldestSeenMessageId ||
        oldestRecent.id !== checkpoint.oldestSeenMessageId);

    let summary = checkpoint.summary || "";

    if (needsSummarization) {
      // Fetch older messages (everything before the oldest recent message)
      const olderMessages = await this.fetchChannelMessages(channelId, {
        limit: 100,
        before: oldestRecent.id
      });

      if (olderMessages.length > 0) {
        // Summarize the older messages
        summary = await this.summarizeMessages(summary, olderMessages);

        // Update checkpoint: we've now processed up to oldestRecent
        this.memory.channelCheckpoints![channelId] = {
          oldestSeenMessageId: oldestRecent.id,
          summary
        };
      }
    }

    return {
      summary,
      recentMessages
    };
  }

  private async summarizeMessages(
    previousSummary: string,
    msgs: DiscordMessage[]
  ): Promise<string> {
    // Sort oldest first
    const sorted = msgs.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));

    const text = sorted
      .map((m) => `${m.author.username ?? m.author.id}: ${m.content ?? ""}`)
      .join("\n");

    const completion: any = await callLlm({
      model: "moonshotai/kimi-k2-0905",
      messages: [
        {
          role: "system",
          content:
            "You are summarizing a Discord thread. Merge new messages into the existing summary. Keep key context: names, decisions, questions, links, topics discussed. Be concise but thorough."
        },
        {
          role: "user",
          content: `Previous summary:\n${previousSummary || "(none)"}\n\nNew messages to add:\n${text}\n\nProvide an UPDATED summary that includes both old and new context.`
        }
      ],
      provider: { only: ["groq"] }
    });

    return completion.content?.trim() || previousSummary || "";
  }

  private async doSomethingSmart(userPrompt: string) {
    // Add user message to database
    this.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: userPrompt
    });

    // Check if we need to summarize and prune messages (rolling window)
    await this.summarizeAndPruneMessages();

    while (true) {
      // Build system prompt with memory
      let systemPrompt = this.memory.system;
      const memory = new Memory(this.memory.blocks, []);
      systemPrompt += memory.compile();

      // Get conversation history from database
      const messages = await this.getMessages();

      // Prepend system message
      const allMessages = [
        { role: "system", content: systemPrompt },
        ...messages
      ];

      const message: any = await callLlm({
        model: "moonshotai/kimi-k2-0905",
        messages: allMessages,
        provider: { only: ["groq"] },
        tools: tools
      });

      // Handle tool calls
      if (message.tool_calls && message.tool_calls.length > 0) {
        // Add assistant message with tool calls
        this.addMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          tool_calls: message.tool_calls
        });

        // Execute tools and add results
        for (const toolCall of message.tool_calls) {
          const response = await callTool(
            toolCall.function.name,
            JSON.parse(toolCall.function.arguments)
          );

          // Add tool result message
          this.addMessage({
            id: crypto.randomUUID(),
            role: "tool",
            content:
              typeof response === "string"
                ? response
                : JSON.stringify(response),
            tool_call_id: toolCall.id
          });
        }
        continue;
      }

      // Add assistant's final response
      const content = message.content;
      this.addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: content
      });

      return content;
    }
  }
}

export default {
  fetch: async (request: Request, env: Env, _ctx: ExecutionContext) => {
    const url = new URL(request.url);

    if (url.pathname === "/start" && request.method === "POST") {
      const gateway = env.DISCORD_GATEWAY.getByName("singleton");
      await gateway.start();
      return new Response("ok");
    }
    return new Response("Not found", { status: 404 });
  }
};

export { DiscordGateway } from "./discord/gateway";
