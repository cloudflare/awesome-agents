# Slack Agent Example

This example shows how to run a conversational Slack bot the Agents SDK. Each workspace that installs the app receives its own Agent instance, so the bot can keep per-team state while staying within Workers' request limits.

## What the bot does
- Replies in a DM or thread any time it is pinged.
- Fetches the relevant conversation history from Slack before calling `generateAIReply` in `src/index.ts`.
- Sends the prompt to OpenAI (you can swap in any compatible model) and hands the answer back to Slack.

## Prerequisites
- A Slack workspace where you can create and install custom apps.
- A Cloudflare account.
- Node.js 18+ and npm.
- An OpenAI-compatible API key (set `OPENAI_BASE_URL` to `https://api.openai.com/v1` if you use OpenAI directly).

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/awesome-agents/tree/main/agents/slack)

## 1. Install dependencies

```bash
npm install
```

## 2. Configure a Slack app
1. Duplicate `slack-manifest.json`, fill in the name, description, and update:
   - `oauth_config.redirect_urls`: set to `https://<your-worker>.workers.dev/accept`.
   - `settings.event_subscriptions.request_url`: set to `https://<your-worker>.workers.dev/slack`.
   - Add the bot events you care about (the example expects `app_mention` and `message.im`).
2. In Slack's [App Management UI](https://api.slack.com/apps), choose **Create App → From manifest → JSON** and paste your updated manifest.
3. Record the generated **Client ID**, **Client Secret**, and **Signing Secret** (Settings → Basic Information → App Credentials).

If you develop with `wrangler dev`, you can use `cloudflared tunnel --url localhost:8787` to get redirect and request URLs.

## 3. Store secrets
The Worker expects the following bindings:

| name | description |
| --- | --- |
| `SLACK_CLIENT_ID` | App Credentials → Client ID |
| `SLACK_CLIENT_SECRET` | App Credentials → Client Secret |
| `SLACK_SIGNING_SECRET` | App Credentials → Signing Secret |
| `OPENAI_API_KEY` | API key for your model provider |
| `OPENAI_BASE_URL` | Base URL for your model provider (`https://api.openai.com/v1` for OpenAI) |

During development you can add them to `.dev.vars`, or run:

```bash
wrangler secret put SLACK_CLIENT_ID
wrangler secret put SLACK_CLIENT_SECRET
wrangler secret put SLACK_SIGNING_SECRET
wrangler secret put OPENAI_API_KEY
wrangler secret put OPENAI_BASE_URL
```

## 4. Run locally or deploy
- **Remote development:** `npm run dev`. You can use `cloudflared tunnel --url localhost:8787` to a public URL for your Slack manifest’s redirect URL and request URL fields before installing.
- **Deploy to Workers:** `npm run deploy`. The deployed worker exposes “install”, “accept”, and “slack” routes under its hostname.

Once the Worker is reachable, visit `https://<your-worker>/install` to start the Slack OAuth flow. After authorizing, Slack sends a token to the worker; the handler stores it in the durable object so every future request for that team is scoped correctly.

## Talking to the bot
1. Add the bot to a channel or DM it.
2. Mention it or send a direct message. The Agent will:
   - Verify the Slack signature.
   - Load the thread or DM history via Slack’s API (`fetchThread` / `fetchConversation`).
   - Call `generateAIReply`, which forwards the conversation to OpenAI with a short system prompt.
   - Post the response back to Slack, keeping replies threaded when you mention the bot in-channel.

### Customizing
- Edit the system prompt and model in `src/index.ts` to change tone or provider.
- Add tools to the model for extra functionality.
- Extend `SlackAgent` if you need additional Slack Web API calls.
- Add persistent data by writing to `this.ctx.storage` inside `MyAgent`.

