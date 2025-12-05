import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from 'discord-interactions';
import { getAgentByName } from 'agents';
import type { Env } from './types';
import { withTimeout } from './utils';

export interface DiscordInteraction {
  type: number;
  id: string;
  token: string;
  channel_id?: string;
  guild_id?: string;
  member?: {
    user: {
      id: string;
      username: string;
    };
  };
  user?: {
    id: string;
    username: string;
  };
  data?: {
    name: string;
    options?: Array<{
      name: string;
      value: string;
    }>;
  };
}

// verify Discord request signature
export async function verifyDiscordRequest(
  request: Request,
  publicKey: string
): Promise<boolean> {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const body = await request.clone().text();

  if (!signature || !timestamp) {
    return false;
  }

  return verifyKey(body, signature, timestamp, publicKey);
}

// discord interactions from user
export async function handleDiscordInteraction(
  interaction: DiscordInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  if (interaction.type === InteractionType.PING) {
    return Response.json({
      type: InteractionResponseType.PONG,
    });
  }

  // Handle application commands
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const commandName = interaction.data?.name;

    if (commandName === 'ask') {
      return await handleAskCommand(interaction, env, ctx);
    }

    if (commandName === 'help') {
      return handleHelpCommand();
    }

    if (commandName === 'reset') {
      return await handleResetCommand(interaction, env);
    }
  }

  return Response.json(
    { error: 'Unknown interaction type' },
    { status: 400 }
  );
}

// /ask handler
async function handleAskCommand(
  interaction: DiscordInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const question = interaction.data?.options?.find(
    (opt) => opt.name === 'question'
  )?.value;

  if (!question) {
    return Response.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: 'Please provide a question!',
        flags: 64, // Ephemeral
      },
    });
  }

  // user info
  const user = interaction.member?.user || interaction.user;
  const userId = user?.id || 'unknown';
  const channelId = interaction.channel_id || 'unknown';
  // defer response
  const deferResponse = Response.json({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
  });

  ctx.waitUntil(
    handleQuestionAsync(interaction, question, userId, channelId, env)
  );

  return deferResponse;
}


async function handleQuestionAsync(
  interaction: DiscordInteraction,
  question: string,
  userId: string,
  channelId: string,
  env: Env
): Promise<void> {
  const followupUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}`;

  try {
    // Get agent stub using the helper
    const agent = await getAgentByName(env.CLOUDFLARE_DOCS_AGENT, channelId);

    // question with timeout (30 seconds max)
    const response = await withTimeout<Response>(
      agent.fetch('http://agent/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, userId, channelId }),
      }),
      30000,
      'Request timed out after 30 seconds'
    );

    if (!response.ok) {
      throw new Error(`Agent returned error: ${response.status}`);
    }

    const result = await response.json() as { answer?: string; error?: string };
    let content = result.answer || result.error || 'Failed to get answer';

    // Discord message limit is 2000 characters
    if (content.length > 2000) {
      content = content.substring(0, 1950) + '\n\n...(truncated)';
    }

    await sendDiscordMessage(followupUrl, content);
  } catch (error) {
    console.error('[handleQuestionAsync] Error:', error);

    let errorMessage = 'Sorry, I encountered an error processing your question.';

    if (error instanceof Error) {
      if (error.message.includes('timed out')) {
        errorMessage = '⏱️ Request timed out. Please try again.';
      } else if (error.message.includes('network')) {
        errorMessage = '🔌 Network error. Please try again in a moment.';
      }
    }

    try {
      await sendDiscordMessage(followupUrl, errorMessage);
    } catch (sendError) {
      console.error('[handleQuestionAsync] Failed to send error:', sendError);
    }
  }
}

// send message
async function sendDiscordMessage(webhookUrl: string, content: string): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    throw new Error(`Discord API error: ${response.status}`);
  }
}

// /help command handler
function handleHelpCommand(): Response {
  const helpText = `
**Cloudflare Docs Bot**

I can help you find information about Cloudflare products and services!

**Commands:**
• \`/ask [question]\` - Ask me anything about Cloudflare
• \`/help\` - Show this help message
• \`/reset\` - Clear conversation history/context

**Examples:**
• \`/ask How do I deploy a Worker?\`
• \`/ask What is the difference between Workers and Pages?\`
• \`/ask How much does Workers AI cost?\`

I ONLY use the official Cloudflare documentation to provide accurate answers.
`;

  return Response.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: helpText.trim(),
    },
  });
}

// /reset command handler
async function handleResetCommand(
  interaction: DiscordInteraction,
  env: Env
): Promise<Response> {
  try {
    const channelId = interaction.channel_id || 'unknown';
    const agent = await getAgentByName(env.CLOUDFLARE_DOCS_AGENT, channelId);

    await agent.fetch('http://agent/reset', {
      method: 'POST',
    });

    return Response.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: 'Conversation history has been reset!',
        flags: 64, // Ephemeral
      },
    });
  } catch (error) {
    console.error('Error resetting conversation:', error);
    return Response.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: 'Failed to reset conversation.',
        flags: 64, // Ephemeral
      },
    });
  }
}

// Register Discord commands
export async function registerDiscordCommands(
  applicationId: string,
  botToken: string
): Promise<void> {
  const commands = [
    {
      name: 'ask',
      description: 'Ask a question about Cloudflare',
      options: [
        {
          name: 'question',
          description: 'Your question about Cloudflare',
          type: 3, // STRING
          required: true,
        },
      ],
    },
    {
      name: 'help',
      description: 'Show help information',
    },
    {
      name: 'reset',
      description: 'Reset conversation history',
    },
  ];

  const response = await fetch(
    `https://discord.com/api/v10/applications/${applicationId}/commands`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${botToken}`,
      },
      body: JSON.stringify(commands),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to register commands: ${error}`);
  }
}
