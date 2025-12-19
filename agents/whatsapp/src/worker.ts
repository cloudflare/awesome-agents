/**
 * Cloudflare Worker Entry Point
 * 
 * This Worker receives WhatsApp webhooks and routes them to Durable Objects.
 * 
 * Architecture:
 * 1. Worker receives HTTP requests (webhooks from WhatsApp)
 * 2. For each user, a unique Durable Object is created/retrieved
 * 3. The Durable Object handles message processing and maintains conversation state
 * 4. Each user's conversation is isolated in their own Durable Object instance
 * 
 * Endpoints:
 * - GET /webhook: WhatsApp webhook verification
 * - POST /webhook: Incoming WhatsApp messages
 * - GET /: Health check
 */

import { Hono } from 'hono';
import { Env } from './env';
import { WhatsAppWebhookPayload } from './types';

// Export the Durable Object so Cloudflare can instantiate it
export { ConversationDurableObject } from './durable-objects/conversation';

// Create Hono app with typed environment
const app = new Hono<{ Bindings: Env }>();

/**
 * Health check endpoint
 */
app.get('/', (c) => {
  return c.json({
    message: 'WhatsApp Cloudflare Agent is running!',
    timestamp: new Date().toISOString(),
  });
});

/**
 * WhatsApp webhook verification endpoint (GET /webhook)
 * 
 * Meta calls this endpoint when you configure the webhook URL.
 * It sends a challenge that we must echo back to verify ownership.
 */
app.get('/webhook', (c) => {
  const mode = c.req.query('hub.mode');
  const verificationToken = c.req.query('hub.verify_token');
  const challenge = c.req.query('hub.challenge');

  if (
    mode === 'subscribe' &&
    verificationToken &&
    verificationToken === c.env.WEBHOOK_VERIFY_TOKEN
  ) {
    console.log('✅ Webhook verified');
    return c.text(challenge || '');
  } else {
    console.error('❌ Webhook verification failed');
    return c.json({ error: 'Verification failed' }, 403);
  }
});

/**
 * WhatsApp message webhook endpoint (POST /webhook)
 * 
 * This endpoint receives incoming messages from WhatsApp.
 * 
 * Flow:
 * 1. Parse the webhook payload
 * 2. Extract the user's WhatsApp ID (wa_id)
 * 3. Get or create a Durable Object for this user
 * 4. Forward the message to the Durable Object for processing
 * 5. The Durable Object handles AI processing and sends the response
 */
app.post('/webhook', async (c) => {
  try {
    const body: WhatsAppWebhookPayload = await c.req.json();

    // Parse webhook payload
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];

    // Skip status updates and non-message webhooks
    if (!changes?.value?.messages || !changes?.value?.contacts) {
      return c.json({ message: 'Not a valid message object' });
    }

    console.log('📨 WhatsApp message received');

    const value = changes.value;
    const contact = value.contacts?.[0];
    const message = value.messages?.[0];

    if (!contact || !message) {
      return c.json({ message: 'Invalid webhook data' });
    }

    // Get user's WhatsApp ID
    const waId = contact.wa_id;

    // Get the Durable Object for this conversation
    // idFromName ensures the same user always gets the same Durable Object
    const id = c.env.CONVERSATIONS.idFromName(waId);
    const stub = c.env.CONVERSATIONS.get(id);

    // Forward the webhook to the Durable Object for processing
    const result = await stub.processMessage(body);

    if (result.success) {
      return c.json({ message: 'Message processed successfully' });
    } else {
      console.error('❌ Processing failed:', result.error);
      return c.json(
        { message: 'Processing failed', error: result.error },
        500
      );
    }
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    return c.json({ error: 'Failed to process message' }, 500);
  }
});

// Export the Hono app as the default Worker handler
export default app;

