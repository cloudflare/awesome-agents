# WhatsApp AI Agent on Cloudflare

Build and deploy a production-ready WhatsApp AI chatbot in minutes using Cloudflare Workers and Durable Objects. Each conversation is automatically isolated with persistent message history, and the architecture scales from zero to millions of users with no configuration.

## Why This Stack?

**Cloudflare Workers** + **Durable Objects** provide a serverless architecture that:
- ✅ Scales automatically (0 to millions of conversations)
- ✅ No database setup required (Durable Objects handle state)
- ✅ Global deployment in seconds
- ✅ Pay only for what you use (~$0 for most small/medium bots)
- ✅ Each user gets isolated, persistent conversation state

## Quick Start

### 1. Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [OpenAI API key](https://platform.openai.com/api-keys)
- Node.js 18+ installed
- 5 minutes to set up WhatsApp Business

### 2. Clone and Install

```bash
git clone https://github.com/coldfrey/whatsapp-cloudflare-agent.git
cd whatsapp-cloudflare-agent
pnpm install
```

### 3. Set Up WhatsApp Business Account

#### Step 1: Create Meta Developer Account

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Click **"Get Started"** and log in with your Facebook account
3. Click **"Create App"**
4. Select **"Other"** as the use case
5. Select **"Business"** as the app type
6. Fill in app details:
   - **App Name**: Choose any name (e.g., "My WhatsApp Bot")
   - **Contact Email**: Your email
7. Click **"Create App"**

#### Step 2: Add WhatsApp Product

1. In your app dashboard, scroll to **"Add products to your app"**
2. Find **"WhatsApp"** and click **"Set up"**
3. You'll be taken to the WhatsApp setup page

#### Step 3: Get Your Credentials

On the WhatsApp setup page, you'll see a **"Temporary access token"** and **"Phone number ID"**:

**Get Phone Number ID:**
1. Under **"Send and receive messages"**, you'll see a **"From"** dropdown
2. The number next to it is your test number
3. Copy the **Phone Number ID** (long numeric string like `123456789012345`)

**Get Access Token:**
1. Under **"Temporary access token"**, click **"Copy"**
2. ⚠️ **Important**: This token expires in 24 hours. For production, generate a permanent token:
   - Go to **System Users** in Business Settings
   - Create a system user
   - Generate a permanent token with `whatsapp_business_messaging` permissions

**Create Verify Token:**
1. Create your own random string (e.g., `my_secret_token_12345`)
2. You'll use this to verify webhooks

### 4. Configure Your Secrets

For production deployment, set secrets in Cloudflare:

```bash
wrangler secret put OPENAI_API_KEY
wrangler secret put SENDER_PHONE
wrangler secret put FACEBOOK_AUTH_TOKEN
wrangler secret put WEBHOOK_VERIFY_TOKEN
```

### 5. Deploy to Cloudflare

```bash
pnpm run deploy
```

Your Worker will be live at: `https://whatsapp-cloudflare-agent.YOUR_SUBDOMAIN.workers.dev`

### 6. Connect WhatsApp Webhook

1. In Meta for Developers, go to **WhatsApp > Configuration**
2. Under **Webhook**, click **"Edit"**
3. Enter your webhook URL:
   ```
   https://whatsapp-cloudflare-agent.YOUR_SUBDOMAIN.workers.dev/webhook
   ```
4. Enter your **Verify Token** (the random string you created in step 3)
5. Click **"Verify and Save"**
6. Under **Webhook fields**, click **"Manage"**
7. Subscribe to **"messages"**
8. Click **"Done"**

### 7. Test Your Bot

1. On the WhatsApp setup page, you'll see a test number (e.g., `+1 555 0100`)
2. Add this number to your WhatsApp contacts
3. Send a message to test your bot! 🎉

## Local Development

For local development, you can test your bot without deploying to Cloudflare using environment variables and Cloudflare Tunnel.

### 1. Create `.env` File

Create a `.env` file in the project root with your environment variables:

```bash
OPENAI_API_KEY=sk-proj-...
SENDER_PHONE=123456789012345
FACEBOOK_AUTH_TOKEN=EAAxxxxxxxxxxxxx...
WEBHOOK_VERIFY_TOKEN=my_secret_token_12345
```

**Note**: `.env` is automatically ignored by git and loaded during local development.

### 2. Start Local Development Server

```bash
pnpm run dev
```

This starts a local server on `http://localhost:8787`

### 3. Expose Localhost with Cloudflare Tunnel

In another terminal, create a tunnel to expose your local server:

```bash
brew install cloudflare/cloudflare/cloudflared
```

```bash
cloudflared tunnel --url http://localhost:8787
```

You'll see output like:

```
Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):
https://random-name-1234.trycloudflare.com
```

Copy this URL - this is your public tunnel endpoint.


### 4. Configure Meta Business Webhook

1. Go to [Meta for Developers](https://developers.facebook.com/) → Your App → WhatsApp → Configuration
2. Under **Webhook**, click **"Edit"**
3. Enter your tunnel URL with `/webhook`:
   ```
   https://random-name-1234.trycloudflare.com/webhook
   ```
4. Enter your **Verify Token** (from your `.env` file)
5. Click **"Verify and Save"**
6. Subscribe to **"messages"** webhook field

### 5. Test Your Local Bot

Send a WhatsApp message to your test number and watch the logs in your terminal! You'll see:
- Incoming webhook payloads
- OpenAI API calls
- Responses being sent



## Project Structure

```
whatsapp-cloudflare-agent/
├── src/
│   ├── worker.ts                    # Entry point (receives webhooks)
│   ├── durable-objects/
│   │   └── conversation.ts          # Per-user conversation logic
│   ├── services/
│   │   └── whatsapp.ts              # WhatsApp API calls
│   ├── types.ts                     # TypeScript types
│   └── env.d.ts                     # Environment types
├── wrangler.toml                    # Cloudflare configuration
└── package.json
```

## How It Works

```
User sends WhatsApp message
    ↓
Meta forwards to your Worker
    ↓
Worker creates/gets Durable Object for user (based on phone number)
    ↓
Durable Object:
  • Loads conversation history from storage
  • Adds new message to history
  • Sends to OpenAI with full context
  • Stores response
  • Sends reply via WhatsApp API
    ↓
User receives response
```

**Key Concept**: Each WhatsApp user gets their own Durable Object instance. This instance:
- Persists conversation history automatically
- Survives across requests and deployments
- Provides strong consistency and isolation
- Scales automatically as you get more users

```
## Resources

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Durable Objects Guide](https://developers.cloudflare.com/durable-objects/)
- [WhatsApp Business API](https://developers.facebook.com/docs/whatsapp)
- [OpenAI API Docs](https://platform.openai.com/docs)
- [Vercel AI SDK](https://sdk.vercel.ai/docs)

## Contributing

This is an open-source template! Feel free to:
- Fork and customize for your needs
- Report issues or bugs
- Submit pull requests
- Share your implementations

## License

MIT License - use freely in your projects!

---

**Built with ❤️ using Cloudflare Workers, Durable Objects, and OpenAI**

Need help? Check the troubleshooting section above or open an issue on GitHub.
