import { DiscordAgent } from "./discord/agent";
import {
  DEFAULT_BLOCKS,
  SYSTEM_INSTRUCTIONS,
  MESSAGE_BUFFER_CONFIG,
  SUMMARY_PROMPT,
  MODEL,
  MODEL_SUMMARY,
} from "./constants";
import { PersistedObject } from "./persisted";
import { renderMemory, type MemoryBlockI } from "./memory";
import { tools } from "./tools";
import { generateText, stepCountIs } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getAgentByName } from "agents";
import { renderDashboard } from "./ui";

type MemoryState = {
  system: string;
  blocks: MemoryBlockI[];
  messageBuffer: string[]; // Array of message IDs in the current context window
};

export class MyAgent extends DiscordAgent {
  readonly memory: MemoryState;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const { kv, sql } = ctx.storage;
    this.memory = PersistedObject<MemoryState>(kv, {
      prefix: "memory_",
      defaults: {
        system: SYSTEM_INSTRUCTIONS,
        blocks: DEFAULT_BLOCKS,
        messageBuffer: [],
      },
    });

    sql.exec(
      "CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, role TEXT NOT NULL, content TEXT, tool_calls TEXT, tool_call_id TEXT)"
    );
  }

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

  private async getMessages(): Promise<
    { role: "user" | "assistant"; content: string }[]
  > {
    const { sql } = this.ctx.storage;

    if (this.memory.messageBuffer.length === 0) {
      return [];
    }

    const placeholders = this.memory.messageBuffer.map(() => "?").join(",");
    const cursor = sql.exec(
      `SELECT * FROM messages WHERE id IN (${placeholders})`,
      ...this.memory.messageBuffer
    );

    const messageMap = new Map<string, any>();
    for (const row of cursor) {
      if (row.role === "user" || (row.role === "assistant" && row.content)) {
        messageMap.set(row.id as string, {
          role: row.role as "user" | "assistant",
          content: row.content as string,
        });
      }
    }

    return this.memory.messageBuffer
      .map((id) => messageMap.get(id))
      .filter((msg) => msg !== undefined);
  }

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
    const openrouter = createOpenRouter({
      apiKey: this.env.OPENROUTER_API_KEY,
    });

    const { text: summary } = await generateText({
      model: openrouter(MODEL_SUMMARY),
      system: SUMMARY_PROMPT,
      prompt: `Conversation to summarize:\n${JSON.stringify(messagesToSummarize, null, 2)}`,
    });

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
    this.info.userId = msg.authorId;
    const reply = await this.chat(msg.content);
    await this.sendDm(reply);
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/state") {
      return this.getStateJson();
    }

    if (url.pathname === "/api/mcp/servers" && request.method === "GET") {
      const mcpState = this.getMcpServers();
      return new Response(JSON.stringify(mcpState, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/api/mcp/servers" && request.method === "POST") {
      const { name, url: serverUrl } = await request.json<{ name: string; url: string }>();
      const result = await this.addMcpServer(name, serverUrl);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/api/mcp/servers" && request.method === "DELETE") {
      const { id } = await request.json<{ id: string }>();
      await this.removeMcpServer(id);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(renderDashboard(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  private getStateJson(): Response {
    const { sql } = this.ctx.storage;

    // Get all messages from DB
    const allMessages: Array<{
      id: unknown;
      role: unknown;
      content: unknown;
      tool_calls: unknown;
      tool_call_id: unknown;
    }> = [];
    for (const row of sql.exec("SELECT * FROM messages")) {
      allMessages.push({
        id: row.id,
        role: row.role,
        content: row.content,
        tool_calls: row.tool_calls
          ? JSON.parse(row.tool_calls as string)
          : null,
        tool_call_id: row.tool_call_id,
      });
    }

    // Get buffered message IDs
    const bufferIds = this.memory.messageBuffer || [];

    // Get messages in current context
    const contextMessages = bufferIds
      .map((id) => allMessages.find((m) => m.id === id))
      .filter(Boolean);

    const state = {
      info: {
        userId: this.info.userId,
        dmChannel: this.info.dmChannel,
      },
      memory: {
        system: this.memory.system,
        blocks: this.memory.blocks,
      },
      context: {
        bufferSize: bufferIds.length,
        maxSize: MESSAGE_BUFFER_CONFIG.MAX_MESSAGES,
        messages: contextMessages,
      },
      storage: {
        totalMessages: allMessages.length,
        allMessages,
      },
    };

    return new Response(JSON.stringify(state, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async chat(userPrompt: string) {
    // Add user message to database
    this.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: userPrompt,
    });

    // Check if we need to summarize and prune messages (rolling window)
    await this.summarizeAndPruneMessages();

    // Build system prompt with memory
    let systemPrompt = this.memory.system;
    const memory = renderMemory(this.memory.blocks);
    systemPrompt += memory;

    // Get conversation history from database
    const messages = await this.getMessages();

    // Create OpenRouter client
    const openrouter = createOpenRouter({
      apiKey: this.env.OPENROUTER_API_KEY,
    });

    // Merge local tools with MCP tools
    const mcpTools = this.mcp.getAITools();
    const allTools = { ...tools, ...mcpTools };

    // Generate response with automatic tool execution
    const result = await generateText({
      model: openrouter(MODEL),
      system: systemPrompt,
      messages,
      tools: allTools,
      stopWhen: stepCountIs(10),
    });

    // Store tool calls and results from steps
    for (const step of result.steps || []) {
      if (step.toolCalls && step.toolCalls.length > 0) {
        // Add assistant message with tool calls
        this.addMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          tool_calls: step.toolCalls.map((tc) => ({
            id: tc.toolCallId,
            function: {
              name: tc.toolName,
              arguments: JSON.stringify(tc.input),
            },
          })),
        });

        // Add tool results
        for (const toolResult of step.toolResults || []) {
          this.addMessage({
            id: crypto.randomUUID(),
            role: "tool",
            content:
              typeof toolResult.output === "string"
                ? toolResult.output
                : JSON.stringify(toolResult.output),
            tool_call_id: toolResult.toolCallId,
          });
        }
      }
    }

    // Add assistant's final response
    const responseText = result.text || "I completed the action but have no additional response.";
    this.addMessage({
      id: crypto.randomUUID(),
      role: "assistant",
      content: responseText,
    });

    return responseText;
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

    // Route dashboard and API requests to the agent
    if (url.pathname === "/" || url.pathname.startsWith("/api")) {
      const agent = await getAgentByName(env.AGENT, "default");
      return agent.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};

export { DiscordGateway } from "./discord/gateway";
