import type { CloudflareDocsAgent } from './agent';

/**
 * Environment bindings for the Cloudflare Worker
 */
export interface Env {
  // Durable Object binding
  CLOUDFLARE_DOCS_AGENT: DurableObjectNamespace<CloudflareDocsAgent>;

  // Workers AI binding
  AI: Ai;

  // Discord configuration (secrets)
  DISCORD_APPLICATION_ID: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;

  // MCP Server configuration
  MCP_SERVER_URL: string;
}

/**
 * Agent state stored in Durable Object
 */
export interface AgentState {
  conversationHistory: Message[];
  userId: string;
  channelId: string;
  createdAt: string;
  lastActivity: string;
}

/**
 * Message structure for conversation history
 */
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  toolCalls?: ToolCall[];
}

/**
 * Tool call structure
 */
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

/**
 * MCP Response structure
 */
export interface MCPResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
}

