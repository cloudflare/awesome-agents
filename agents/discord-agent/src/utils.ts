import { env } from "cloudflare:workers";

const CORE_MEMORY_LINE_NUMBER_WARNING =
  "# NOTE: Line numbers shown below (with arrows like '1→') are to help during editing. Do NOT include line number prefixes in your memory edit tool calls.";

export interface MemoryBlockI extends Record<string, unknown> {
  /** Unique identifier for the block */
  label: string;
  /** Describes the purpose of the block */
  description: string;
  /** Contents/data of the block */
  value: string;
  /** Size limit of the block in characters. */
  limit: number;
  /** Whether the block is read-only */
  readOnly?: boolean;
  /** Last updated */
  lastUpdated: number;
}

export interface FileBlockI extends Record<string, unknown> {
  /** Unique identifier for the block */
  label: string;
  description: string;
  status: "open" | "closed";
  value?: string;
  limit?: number;
}

export class Memory {
  constructor(
    private blocks: MemoryBlockI[],
    private fileBlocks: FileBlockI[]
  ) {}

  renderMemoryBlocks(s: string, includeLineNumbers = false) {
    if (this.blocks.length === 0) return s;

    s +=
      "<memory_blocks>\nThe following memory blocks are currently engaged in your core memory unit:\n\n";

    this.blocks.forEach((block, idx) => {
      const label = block.label ?? "block";
      const value = block.value ?? "";
      const desc = block.description ?? "";
      const currentChars = value.length;
      const limit = block.limit ?? 0;
      s += `<${label}>\n`;
      s += "<description>\n";
      s += `${desc}\n`;
      s += "</description>\n";
      s += "<metadata>";
      if (block.readOnly) s += "\n- read_only=true";
      s += `\n- chars_current=${currentChars}`;
      s += `\n- chars_limit=${limit}\n`;
      s += "</metadata>\n";
      s += "<value>\n";
      if (includeLineNumbers) {
        s += `${CORE_MEMORY_LINE_NUMBER_WARNING}\n`;
        if (value) {
          value.split("\n").forEach((line, idx) => {
            s += `Line ${idx}: ${line}\n`;
          });
        }
      } else {
        s += `${value}\n`;
      }
      s += "</value>\n";
      s += `</${label}>\n`;
      if (idx != this.blocks.length - 1) s += "\n";
    });

    s += "\n</memory_blocks>";
    return s;
  }

  renderDirectories(s: string, sources: any[], maxFilesOpen?: number) {
    s += "\n\n<directories>\n";
    if (maxFilesOpen) {
      const currentOpen = this.blocks.filter((b) => b.value).length;
      s += "<file_limits>\n";
      s += `- current_files_open=${currentOpen}\n`;
      s += `- max_files_open=${maxFilesOpen}\n`;
      s += "</file_limits>\n";
    }
    this.fileBlocks.forEach((fb) => {
      const status = fb.value ? "open" : "closed";
      const label = fb.label ?? "file";
      const desc = fb.description ?? "";
      const currentChars = (fb.value ?? "").length;
      const limit = fb.limit ?? 0;

      s += `<file status="${status}" name="${label}">\n`;
      if (desc) {
        s += "<description>\n";
        s += `${desc}\n`;
        s += "</description>\n";
      }
      s += "<metadata>";
      s += `\n- chars_current=${currentChars}`;
      s += `\n- chars_limit=${limit}\n`;
      s += "</metadata>\n";
      if (fb.value) {
        s += "<value>\n";
        s += `${fb.value}\n`;
        s += "</value>\n";
      }
      s += "</file>\n";
    });

    s += "</directories>\n";
    return s;
  }

  renderMemoryMetadata(s: string) {
    // - 42 previous messages between you and the user are stored in recall memory (use tools to access them)
    // - 156 total memories you created are stored in archival memory (use tools to access them)
    // - Available archival memory tags: project_x, meeting_notes, research, ideas
    return (
      s +
      `<memory_metadata>
- The current time is: ${new Date().toDateString()}
- Memory blocks were last modified: ${new Date(this.blocks.reduce((acc, b) => Math.max(acc, b.lastUpdated), 0)).toDateString()}
</memory_metadata>
`
    );
  }

  compile() {
    let s = "";
    s = this.renderMemoryBlocks(s);
    // s = this.renderDirectories(s, []);
    s = this.renderMemoryMetadata(s);
    return s;
  }
}

export function hexToBytes(hex: string): ArrayBuffer {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2) throw new Error("bad hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out.buffer;
}

// Verify Discord interactions: Ed25519(signature, timestamp + rawBody) with *public* key
export async function verifyDiscordRequest(
  publicKeyHex: string,
  signatureHex: string | null,
  timestamp: string | null,
  rawBody: string
) {
  if (!signatureHex || !timestamp) return false;
  // optional replay guard (5 mins)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 300) return false;

  const publicKey = await crypto.subtle.importKey(
    "raw",
    hexToBytes(publicKeyHex),
    { name: "Ed25519" },
    false,
    ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "Ed25519",
    publicKey,
    hexToBytes(signatureHex),
    new TextEncoder().encode(timestamp + rawBody)
  );
  return !!ok;
}

// Rate‑limit friendly fetch for Discord REST
export async function discordFetch(
  path: string,
  init: RequestInit & { botToken: string }
): Promise<Response> {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bot ${init.botToken}`);
  if (
    !headers.has("Content-Type") &&
    init.body &&
    !(init.body instanceof FormData)
  ) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }
  const res = await fetch(`${DISCORD_API}${path}`, { ...init, headers });

  if (res.status !== 429) return res;

  // Respect per-route/global limits. Retry once after retry_after.
  // (Discord says: parse headers/body, don't hardcode numbers.)
  const data: any = await res.json().catch(() => ({}));
  const retryAfterMs = Math.ceil((data.retry_after ?? 1) * 1000);
  await new Promise((r) => setTimeout(r, retryAfterMs));
  return fetch(`${DISCORD_API}${path}`, { ...init, headers });
}

export const DISCORD_API = "https://discord.com/api/v10";

export const callLlm = async (body: any) => {
  const gateway = await env.AI.gateway("all-in-one").getUrl("openrouter");
  const response = await fetch(`${gateway}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.CF_API_TOKEN}`
    },
    body: JSON.stringify(body)
  });
  const json = await response.json<any>();
  const message = json.choices[0].message;
  return message;
};
