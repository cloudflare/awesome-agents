# Discord Personal Agent

A hackable personal AI agent that lives in your Discord DMs. Built with [Cloudflare Agents SDK](https://github.com/cloudflare/agents), it features persistent memory, self-editing capabilities, automatic context management, MCP integration, and a web dashboard for introspection.

**This is a _personal_ agent** — it talks to you directly via DMs, not in server channels. It remembers who you are, learns your preferences, and evolves over time. If you're looking for a server-based bot (slash commands, channel responses), check out the [cloudflare-docs-discord-bot](../cloudflare-docs-discord-bot) example instead.

## Features

- **Persistent Memory Blocks** — Editable persona and user profile that the agent maintains ([Letta AI style](https://letta.com), check them out!)
- **Self-Improving** — The agent can edit its own memory to remember things and refine its behavior
- **Rolling Context Window** — Automatic summarization when context grows too large
- **MCP Integration** — Connect external MCP servers to give your agent new tools
- **Web Dashboard** — Inspect memory, messages, context, and manage MCP connections
- **Built on Durable Objects** — State persists across restarts and deploys

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Cloudflare Worker                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐       ┌──────────────────────────────┐    │
│  │  DiscordGateway  │       │           MyAgent            │    │
│  │  (Durable Object)│       │       (Durable Object)       │    │
│  │                  │       │                              │    │
│  │  • WebSocket to  │──────▶│  • Memory (persisted KV)     │    │
│  │    Discord       │       │  • Messages (SQLite)         │    │
│  │  • Heartbeat via │       │  • Tools (local + MCP)       │    │
│  │    DO Alarm      │       │  • LLM calls (OpenRouter)    │    │
│  │  • Routes DMs    │       │  • Web dashboard             │    │
│  └──────────────────┘       └──────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

| File | Purpose |
|------|---------|
| `src/index.ts` | Main agent class (`MyAgent`), chat loop, message handling, dashboard routing |
| `src/discord/gateway.ts` | WebSocket connection to Discord, heartbeats, dispatches DM events |
| `src/discord/agent.ts` | Base class for Discord agents with DM utilities |
| `src/memory.ts` | Memory block rendering for system prompts |
| `src/persisted.ts` | Proxy wrapper for auto-persisting state to Durable Object KV |
| `src/tools.ts` | Memory editing built-in tools |
| `src/constants.ts` | System prompt, models, default memory blocks |
| `src/ui.ts` | Web dashboard HTML |

## Quick Start

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/awesome-agents/tree/main/agents/discord-agent)

### 1. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to **Bot** section:
   - Click "Add Bot"
   - Go to "Settings" -> "Bot" -> "Reset Token" to get your token. **Make a note of the token**.
   - Enable **Message Content Intent** (required for reading DM content)
4. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`
   - Bot Permissions: `Send Messages`
   - Copy the URL and invite the bot to any server (it only needs to exist somewhere)

> **Note**: The bot doesn't actually do anything in servers — it just needs to be in one to be "alive" on Discord. All interaction happens via DMs.

### 2. Get API Keys

You'll need:
- **Discord Bot Token** — from step 1
- **OpenRouter API Key** — from [openrouter.ai](https://openrouter.ai). (You can update the AI SDK provider to any other LLM provider if you prefer)

### 3. Configure

Create `.dev.vars` for local development:

```bash
DISCORD_BOT_TOKEN=your_discord_bot_token
OPENROUTER_API_KEY=your_openrouter_key
```

For production, set secrets:

```bash
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put OPENROUTER_API_KEY
```

### 4. Install & Deploy

```bash
npm install
npm run dev # for local development
npm run deploy # to deploy :D
```

### 5. Start the Gateway

The Discord WebSocket gateway needs to be started once after deploy:

```bash
curl -X POST https://your-worker.workers.dev/start
```

Or visit the dashboard at `https://your-worker.workers.dev` and click "Start Gateway".

### 6. DM Your Bot

Find your bot on Discord and send it a direct message. That's it!

## Understanding the Patterns



### Pattern 1: Memory Blocks

Memory blocks are chunks of persistent context that get injected into every system prompt. The agent can read and edit them using tools:

```typescript
const DEFAULT_BLOCKS = [
  {
    label: "persona",
    description: "Stores details about your persona...",
    value: "I am Rinzler. I'm curious, empathetic...",
    limit: 5000,
    lastUpdated: Date.now()
  },
  {
    label: "human", 
    description: "Stores key details about the person...",
    value: "First name: ?\nLast name: ?...",
    limit: 5000,
    lastUpdated: Date.now()
  }
];
```

The agent sees these blocks in its context and can use `memoryInsert` and `memoryReplace` tools to modify them, creating a self-improving loop.

### Pattern 2: Rolling Context Window

Instead of keeping all messages forever (expensive and eventually hits limits), the agent maintains a rolling window:

1. Messages accumulate in a buffer (stored in SQLite)
2. When buffer exceeds `MAX_MESSAGES` (default: 50), trigger summarization
3. LLM summarizes the oldest 70% of messages into a single summary message
4. Buffer is pruned, summary replaces old messages
5. Full history remains in SQLite for persistence

```typescript
// From constants.ts
export const MESSAGE_BUFFER_CONFIG = {
  MAX_MESSAGES: 50,
  PRUNE_PERCENTAGE: 0.7,
  SUMMARY_MESSAGE_ID_PREFIX: "summary_"
};
```

### Pattern 3: MCP Tool Integration

The agent uses the Agents SDK's built-in MCP support to dynamically add tools:

```typescript
// Get MCP tools and merge with local tools
const mcpTools = this.mcp.getAITools();
const allTools = { ...tools, ...mcpTools };

// Pass to LLM
const result = await generateText({
  model: openrouter(MODEL),
  tools: allTools,
  // ...
});
```

Add MCP servers via the dashboard or API:

```bash
curl -X POST https://your-worker.workers.dev/api/mcp/servers \
  -H "Content-Type: application/json" \
  -d '{"name": "my-mcp", "url": "https://mcp-server.example.com/mcp"}'
```

### Pattern 4: Persisted Proxy Objects

The `PersistedObject` utility creates JavaScript objects that automatically sync to Durable Object KV storage:

```typescript
// In your agent constructor
this.memory = PersistedObject<MemoryState>(kv, {
  prefix: "memory_",
  defaults: {
    system: SYSTEM_INSTRUCTIONS,
    blocks: DEFAULT_BLOCKS,
  },
});

// Later, just assign normally — it auto-persists
this.memory.blocks = [...this.memory.blocks, newBlock];
```

**Key insight**: Mutations don't persist (and will warn you). Always reassign:

```typescript
// ❌ Won't persist
this.memory.blocks.push(newBlock);

// ✅ Will persist
this.memory.blocks = [...this.memory.blocks, newBlock];
```

## Extending the Agent

### Add New Tools

Edit `src/tools.ts`:

```typescript
import { tool } from "ai";
import { z } from "zod";

export const myNewTool = tool({
  description: "What this tool does",
  inputSchema: z.object({
    param: z.string().describe("What this param is for")
  }),
  execute: async ({ param }) => {
    // Access agent state via getCurrentAgent()
    const { agent } = getCurrentAgent<MyAgent>();
    
    // Do something
    return "Result";
  }
});

// Add to exports
export const tools = {
  memoryInsert,
  memoryReplace,
  internetSearch,
  readWebsite,
  myNewTool  // ← add here
};
```

### Add New Memory Blocks

Edit `src/constants.ts`:

```typescript
export const DEFAULT_BLOCKS = [
  // ... existing blocks
  {
    label: "projects",
    description: "Track ongoing projects and their status",
    value: "",
    limit: 3000,
    lastUpdated: Date.now()
  }
];
```

> **Note**: New blocks only apply to fresh agents. Existing agents keep their current memory.

### Change the Model

Edit `src/constants.ts`:

```typescript
// Default uses OpenRouter with Kimi K2
export const MODEL = 'moonshotai/kimi-k2-0905';

// Or try others:
export const MODEL = 'anthropic/claude-sonnet-4';
export const MODEL = 'openai/gpt-4o';
export const MODEL = 'google/gemini-2.0-flash-001';
```

### Use Workers AI Instead

Replace the OpenRouter setup in `src/index.ts`:

```typescript
// Instead of:
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
const openrouter = createOpenRouter({ apiKey: this.env.OPENROUTER_API_KEY });

// Use:
import { createWorkersAI } from "workers-ai-provider";
const ai = createWorkersAI({ binding: this.env.AI });

// Then in generateText:
const result = await generateText({
  model: ai("@cf/meta/llama-3.1-70b-instruct"),
  // ...
});
```

### Customize the Persona

Edit `src/constants.ts` to change `SYSTEM_INSTRUCTIONS` or the default persona in `DEFAULT_BLOCKS`.

### Handle More Discord Events

Extend `onDispatch` in `src/discord/gateway.ts`:

```typescript
private async onDispatch(t: string, d: any) {
  switch (t) {
    case "MESSAGE_CREATE":
      // existing DM handling
      break;
    case "TYPING_START":
      // user is typing
      break;
    case "PRESENCE_UPDATE":
      // user status changed
      break;
  }
}
```

## Dashboard

Visit your worker URL (`https://your-worker.workers.dev`) to see:

- **Agent Info** — User ID, DM channel
- **Storage Stats** — Message counts, context usage
- **MCP Servers** — Connected servers and available tools
- **Memory Blocks** — Current persona and user profile
- **Context Window** — Messages in active context
- **Message History** — All stored messages

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Dashboard UI |
| `/start` | POST | Start the Discord gateway |
| `/api/state` | GET | Full agent state as JSON |
| `/api/mcp/servers` | GET | List connected MCP servers |
| `/api/mcp/servers` | POST | Add MCP server `{name, url}` |
| `/api/mcp/servers` | DELETE | Remove MCP server `{id}` |

## Troubleshooting

### Bot doesn't respond to DMs

1. Check gateway is running (dashboard shows "Gateway started")
2. Verify **Message Content Intent** is enabled in Discord Developer Portal
3. Check logs: `npx wrangler tail`

### "onDmMessage not implemented"

You're using the base `DiscordAgent` class directly. Extend it and implement `onDmMessage`.

### Memory not persisting

Remember: mutations don't persist. Always reassign:
```typescript
// ✅ Correct
this.memory.blocks = [...this.memory.blocks, newBlock];
```

### Context growing too fast

Adjust `MESSAGE_BUFFER_CONFIG` in `src/constants.ts`:
```typescript
MAX_MESSAGES: 30,      // Trigger summarization sooner
PRUNE_PERCENTAGE: 0.8  // Remove more when pruning
```

## Learn More

- [Cloudflare Agents SDK](https://github.com/cloudflare/agents)
- [Agents Documentation](https://developers.cloudflare.com/agents/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Discord Gateway API](https://discord.com/developers/docs/topics/gateway)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Vercel AI SDK](https://sdk.vercel.ai/)
