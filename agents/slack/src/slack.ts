import { Agent, getAgentByName } from "agents";
import { env as cfEnv } from "cloudflare:workers";

interface ServeOptions {
  clientId: string;
  clientSecret: string;
  scopes: string[];
  baseUrl?: string;
  slackSigningSecret: string;
}

async function verify(secret: string, ts: string, raw: string, sig: string) {
  if (!ts || !sig) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > 300) return false; // replay guard

  const base = `v0:${ts}:${raw}`;
  const expected = await hmacSHA256(secret, base);
  return timingSafeEqual(`v0=${expected}`, sig);
}

async function hmacSHA256(key: string, msg: string) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(msg));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string) {
  const A = new TextEncoder().encode(a);
  const B = new TextEncoder().encode(b);
  if (A.length !== B.length) return false;
  let diff = 0;
  for (let i = 0; i < A.length; i++) diff |= A[i] ^ B[i];
  return diff === 0;
}

type SlackMsg = {
  user?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  subtype?: string;
  bot_id?: string;
};

export class SlackAgent extends Agent {
  get token() {
    return this.ctx.storage.kv.get("slack_token");
  }

  init(token: string) {
    this.ctx.storage.kv.put("slack_token", token);
  }

  protected appUserId?: string;

  async ensureAppUserId() {
    if (this.appUserId) return this.appUserId;
    const res = await fetch("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${this.token}` }
    });
    const json = await res.json<{ user_id?: string }>();
    this.appUserId = json.user_id || "UNKNOWN";
    return this.appUserId;
  }

  async onSlackEvent(event: { type: string } & Record<string, unknown>) {
    throw new Error(
      "Received slack event but didn't you haven't overriden onSlackEvent"
    );
  }

  async sendMessage(message: string, opts: Record<string, unknown>) {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({ text: message, ...opts })
    });
    if (!res.ok) console.error("Slack API HTTP", res.status, await res.text());
  }

  async fetchThread(channel: string, rootTs: string, oldest?: string) {
    const params = new URLSearchParams({
      channel,
      ts: rootTs,
      limit: "1000",
      inclusive: "true"
    });
    if (oldest) params.set("oldest", oldest);
    const res = await fetch(
      "https://slack.com/api/conversations.replies?" + params.toString(),
      {
        headers: { Authorization: `Bearer ${this.token}` }
      }
    );
    const data = await res.json<{ ok: boolean; messages: SlackMsg[] }>();
    if (!data.ok) throw new Error("Failed to read thread");
    // Return sorted ascending by ts
    return data.messages.sort((a, b) => Number(a.ts) - Number(b.ts));
  }

  async fetchConversation(channel: string, oldest?: string) {
    const params = new URLSearchParams({
      channel,
      limit: "1000"
    });
    if (oldest) params.set("oldest", oldest);
    const res = await fetch(
      "https://slack.com/api/conversations.history?" + params.toString(),
      {
        headers: { Authorization: `Bearer ${this.token}` }
      }
    );
    const data = await res.json<{ ok: boolean; messages: SlackMsg[] }>();
    if (!data.ok) throw new Error("Failed to read thread");
    // Return sorted ascending by ts
    return data.messages.sort((a, b) => Number(a.ts) - Number(b.ts));
  }

  static listen({
    clientId,
    clientSecret,
    scopes,
    baseUrl,
    slackSigningSecret
  }: ServeOptions) {
    let prefix = baseUrl ?? "";
    return {
      async fetch(request: Request, env: typeof cfEnv, ctx: ExecutionContext) {
        const url = new URL(request.url);
        if (!url.pathname.startsWith(prefix))
          return new Response("Not found", { status: 404 });

        // Request is trying to install the slack app in their workspace, so we
        // redirect to the OAuth URL with the required scopes + our clientId.
        if (url.pathname === `${prefix}/install`) {
          const installUrl = new URL("https://slack.com/oauth/v2/authorize");
          installUrl.searchParams.set("client_id", clientId);
          installUrl.searchParams.set("scope", scopes.join(","));

          const redirectUri = "https://" + url.host + prefix + "/accept";
          installUrl.searchParams.set("redirect_uri", redirectUri);
          installUrl;

          return new Response(null, {
            status: 301,
            headers: { Location: installUrl.toString() }
          });
        }

        if (url.pathname === `${prefix}/accept`) {
          const code = url.searchParams.get("code");
          if (!code) return new Response("Missing code param", { status: 400 });

          const formData = new FormData();
          formData.append("code", code);
          formData.append("client_id", clientId);
          formData.append("client_secret", clientSecret);
          const redirectUri = "https://" + url.host + prefix + "/accept";
          formData.append("redirect_uri", redirectUri);

          const response = await fetch(
            "https://slack.com/api/oauth.v2.access?redirect_uri=" + redirectUri,
            {
              method: "POST",
              body: formData
            }
          );

          // There must be a field here we can route to our agent with.
          const data = await response.json<{
            team?: { id: string };
            access_token: string;
          }>();
          const teamId = data.team?.id;
          if (!teamId) return new Response("Missing team id", { status: 400 });

          const agent = await getAgentByName(env.MyAgent, teamId);
          agent.init(data.access_token);
          return new Response("Successfully registered!", { status: 200 });
        }

        // Slack entrypoint with the Events API
        if (url.pathname === `${prefix}/slack`) {
          const raw = await request.text();

          // Verify Slack signature
          const ts = request.headers.get("X-Slack-Request-Timestamp");
          const sig = request.headers.get("X-Slack-Signature");
          if (!(await verify(slackSigningSecret, ts || "", raw, sig || ""))) {
            return new Response("bad sig", { status: 401 });
          }

          const ct = request.headers.get("Content-Type") || "";
          if (!ct.includes("application/json"))
            return new Response("", { status: 200 });

          const body = JSON.parse(raw);

          // Slack's URL check when you first enable Events
          if (body.type === "url_verification") {
            return Response.json({ challenge: body.challenge });
          }

          if (!body.team_id)
            return new Response("Missing team id", { status: 400 });

          const agent = await getAgentByName(env.MyAgent, body.team_id);
          agent.onSlackEvent(body.event);
          return new Response("OK");
        }

        return new Response("Not found", { status: 404 });
      }
    };
  }
}
