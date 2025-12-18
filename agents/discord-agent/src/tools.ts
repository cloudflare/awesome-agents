import { zodFunction } from "openai/helpers/zod";
import { getCurrentAgent } from "agents";
import type { MyAgent } from ".";

import { z } from "zod";
import { env } from "cloudflare:workers";

const MemoryInsertParams = z.object({
  label: z.string().describe("Which memory block to edit."),
  new_str: z.string().describe("Text to insert."),
  insert_line: z.number().describe("Line number (0 for beginning, -1 for end)")
});

type MemoryInsertParamsT = z.infer<typeof MemoryInsertParams>;

const memoryInsertDef = zodFunction({
  name: "memory_insert",
  description:
    "The memory_insert command allows you to insert text at a specific location in a memory block.",
  parameters: MemoryInsertParams
});

const memoryInsert = (params: MemoryInsertParamsT) => {
  const { agent } = getCurrentAgent<MyAgent>();
  if (!agent) throw new Error("Expected agent");

  if (!agent.memory.blocks.find((b) => b.label === params.label)) {
    return "Block not found";
  }

  const blocks = agent.memory.blocks.map((b) => {
    if (b.label === params.label) {
      const lines = b.value.split("\n");
      lines.splice(params.insert_line, 0, params.new_str);
      return { ...b, value: lines.join("\n"), lastUpdated: Date.now() };
    }
    return b;
  });

  agent.memory.blocks = blocks;
  return "Successfully inserted into memory block";
};

const MemoryReplaceParams = z.object({
  label: z.string().describe("Which memory block to edit"),
  old_str: z.string().describe("Exact text to find and replace"),
  new_str: z.string().describe("Replacement text")
});

type MemoryReplaceParamsT = z.infer<typeof MemoryReplaceParams>;

const memoryReplaceDef = zodFunction({
  name: "memory_replace",
  description:
    "The memory_replace command allows you to replace a specific string in a memory block with a new string. This is used for making precise edits.",
  parameters: MemoryReplaceParams
});

const memoryReplace = (params: MemoryReplaceParamsT) => {
  const { agent } = getCurrentAgent<MyAgent>();
  if (!agent) throw new Error("Expected agent");

  if (!agent.memory.blocks.find((b) => b.label === params.label)) {
    return "Block not found";
  }

  const blocks = agent.memory.blocks.map((b) => {
    if (b.label === params.label) {
      return {
        ...b,
        value: b.value.replaceAll(params.old_str, params.new_str),
        lastUpdated: Date.now()
      };
    }
    return b;
  });

  agent.memory.blocks = blocks;
  return "Successfully inserted into memory block";
};

const InternetSearchParams = z.object({
  query: z.string().describe("The query to search for")
});

type InternetSearchParamsT = z.infer<typeof InternetSearchParams>;

const internetSearchDef = zodFunction({
  name: "internet_search",
  description: "Search the internet for information",
  parameters: InternetSearchParams
});

const internetSearch = async (params: InternetSearchParamsT) => {
  const retries = 3;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.TAVILY_API_KEY}`
        },
        body: JSON.stringify({ query: params.query })
      });
      if (response.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
      if (!response.ok) {
        throw new Error(
          `Failed to search the internet: ${response.statusText}`
        );
      }
      return response.text();
    } catch (error) {
      if (i >= retries - 1) {
        throw error;
      }
    }
  }
  return "Error: Failed to search the internet";
};

const ReadWebsiteParams = z.object({
  urls: z.array(z.string()).describe("The URLs to read from")
});

type ReadWebsiteParamsT = z.infer<typeof ReadWebsiteParams>;

const readWebsiteDef = zodFunction({
  name: "read_website",
  description: "Read the contents of a website(s) for information",
  parameters: ReadWebsiteParams
});

const readWebsites = async (params: ReadWebsiteParamsT) => {
  const retries = 3;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch("https://api.tavily.com/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.TAVILY_API_KEY}`
        },
        body: JSON.stringify({ urls: params.urls })
      });
      if (response.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
      if (!response.ok) {
        throw new Error(
          `Failed to search the internet: ${response.statusText}`
        );
      }
      return response.text();
    } catch (error) {
      if (i >= retries - 1) {
        throw error;
      }
    }
  }
  return "Error: Failed to read the website(s)";
};

export const tools = [
  memoryInsertDef,
  memoryReplaceDef,
  internetSearchDef,
  readWebsiteDef
];

export const callTool = async (toolName: string, args: any) => {
  try {
    if (toolName === "memory_insert") return memoryInsert(args);
    if (toolName === "memory_replace") return memoryReplace(args);
    if (toolName === "internet_search") return internetSearch(args);
    if (toolName === "read_website") return readWebsites(args);
  } catch (e: unknown) {
    return e instanceof Error ? e.message : "Unknown error";
  }
};
