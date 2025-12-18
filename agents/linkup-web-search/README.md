# Linkup Web Search Tool for Cloudflare Agents

AI applications and agents need access to realtime information from the internet. Linkup is a web search engine for AI apps that provides grounding data to enrich your AI’s output and increase its precision, accuracy and factuality.

Use [Linkup](https://www.linkup.so/) as a real-time web search tool inside Cloudflare Agents. This guide shows how to add the Linkup tool definition, wire it into your agent's system prompt, and configure the required secrets.

## What it does
- Adds a `linkupWebSearch` tool that performs web searches (standard or deep) via the Linkup API
- Returns sourced answers, raw search results, or structured data with optional images
- Guides the agent to call the tool automatically when a user asks for current or external information

## Prerequisites
- Cloudflare account and Wrangler CLI
- Node.js 18+
- [Linkup account](https://app.linkup.so/sign-up) with an API key (free tier works)
- OpenAI-compatible model key (for your agent) if not already configured

## 1) Create or open a Cloudflare Agents project
If you need a starter project:

```bash
npx create-cloudflare@latest --template cloudflare/agents-starter
```

Then `cd` into your project directory.

## 2) Set API keys
Add your keys to `.dev.vars` for local development:

```
OPENAI_API_KEY=your_openai_api_key
LINKUP_API_KEY=your_linkup_api_key
```

For production, store them as Wrangler secrets:

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put LINKUP_API_KEY
```

## 3) Install dependencies

```bash
npm install linkup-sdk
npm install
```

## 4) Add the Linkup tool definition
Create or update `src/tools.ts` to include the tool and export it:

```ts
import { LinkupClient } from "linkup-sdk";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

// 1. Define the tool
export const linkupWebSearch = tool({
  description: "Perform web search via Linkup. Use this for any request needing current or external information.",
  inputSchema: z.object({
    query: z.string().describe("Natural language search query"),
    depth: z.enum(["standard", "deep"]).optional(),
    outputType: z.enum(["searchResults", "sourcedAnswer", "structured"]).optional(),
    includeImages: z.boolean().optional(),
  }),
  execute: async (args) => {
    if (!process.env.LINKUP_API_KEY) {
      throw new Error("LINKUP_API_KEY is missing");
    }
    const client = new LinkupClient({ apiKey: process.env.LINKUP_API_KEY });
    return client.search({
      query: args.query,
      depth: args.depth ?? "standard",
      outputType: args.outputType ?? "sourcedAnswer",
      includeImages: args.includeImages,
    });
  }
});

// 2. Add it to the exported tools object
export const tools = {
  // ...existing tools
  linkupWebSearch
} satisfies ToolSet;
```

## 5) Instruct the agent when to use the tool
Update the system prompt inside the `streamText` call in `src/server.ts` (or wherever you build the agent):

```ts
const result = streamText({
  system: `You are a helpful assistant...

If the user requests current information, web sources, news, or citations, call the tool "linkupWebSearch" (prefer depth=standard; use depth=deep for complex or niche queries). Return sourced answers when possible.`,
  // ...
});
```

## Toolkit reference

| Function | Description |
| --- | --- |
| `linkupWebSearch` | Searches the web for a query using Linkup. Supports optional `depth`, `outputType`, and `includeImages`. |

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `apiKey` | Optional string | `LINKUP_API_KEY` env | API key for authentication. |
| `depth` | `"standard" \| "deep"` | `"standard"` | Standard for fast/affordable; deep for comprehensive search. |
| `outputType` | `"sourcedAnswer" \| "searchResults" \| "structured"` | `"sourcedAnswer"` | Response shape. |
| `includeImages` | boolean | `false` | Whether to include images. |

## Example response
Once configured, prompt your agent with a query like "What's the current INR to POUND exchange rate?". The agent will call `linkupWebSearch` and return a sourced answer with citations. For queries that do not need a web search, the agent will skip calling the tool.


https://github.com/user-attachments/assets/39ea2ddc-015c-427c-9130-84fcc26aae76


You are now ready to use Linkup as a web search tool in Cloudflare Agents!
