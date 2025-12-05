import {
  verifyDiscordRequest,
  handleDiscordInteraction,
  registerDiscordCommands,
  type DiscordInteraction,
} from './discord';
import type { Env } from './types';

export { CloudflareDocsAgent } from './agent';

// worker entry point
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle Discord interactions
    if (url.pathname === '/discord' && request.method === 'POST') {
      // Verify Discord signature
      const isValid = await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY);

      if (!isValid) {
        return new Response('Invalid request signature', { status: 401 });
      }

      const interaction = await request.json() as DiscordInteraction;

      return await handleDiscordInteraction(interaction, env, ctx);
    }

    if (url.pathname === '/setup' && request.method === 'POST') {
      try {
        await registerDiscordCommands(
          env.DISCORD_APPLICATION_ID,
          env.DISCORD_BOT_TOKEN
        );

        return Response.json({
          success: true,
          message: 'Discord commands registered successfully',
        });
      } catch (error) {
        console.error('Setup error:', error);
        return Response.json(
          {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          { status: 500 }
        );
      }
    }

    if (url.pathname === '/health') {
      return Response.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'cloudflare-docs-discord-bot',
      });
    }

    // Root endpoint - information
    if (url.pathname === '/') {
      return new Response(
        `
Cloudflare Docs Discord Bot

This is a Discord bot that answers questions about Cloudflare using:
- Workers AI (Qwen 2.5 Coder 32B)
- MCP Documentation Server
- Durable Objects

Endpoints:
- POST /discord - Discord interaction webhook
- POST /setup - Register Discord commands
- GET /health - Health check

To use this bot:
1. Set up your Discord application at https://discord.com/developers
2. Configure secrets: DISCORD_APPLICATION_ID, DISCORD_PUBLIC_KEY, DISCORD_BOT_TOKEN
3. Deploy to Cloudflare Workers
4. Call POST /setup to register commands
5. Set Discord interaction URL to: https://your-worker.workers.dev/discord
6. Invite the bot to your server
7. Use /ask, /help, and /reset commands

Documentation:
- Workers AI: https://developers.cloudflare.com/workers-ai/
- MCP Server: https://github.com/cloudflare/mcp-server-cloudflare
- Durable Objects: https://developers.cloudflare.com/durable-objects/
- Discord Bots: https://discord.com/developers/docs
        `.trim(),
        {
          headers: {
            'Content-Type': 'text/plain',
          },
        }
      );
    }

    return new Response('Not Found', { status: 404 });
  },
};
