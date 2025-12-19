/**
 * WhatsApp API Service
 * 
 * Provides functions for interacting with the WhatsApp Business API:
 * - sendTextMessage: Send a text message to a WhatsApp user
 * - markMessageAsRead: Send a read receipt for a message
 */

import { Env } from '../env';

/**
 * Send a text message via WhatsApp Business API
 */
export async function sendTextMessage(
  message: string,
  recipient: string,
  env: Env
): Promise<void> {
  const url = `https://graph.facebook.com/v22.0/${env.SENDER_PHONE}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to: recipient,
    type: 'text',
    text: { body: message },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.FACEBOOK_AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to send WhatsApp message: ${error}`);
  }
}

/**
 * Mark a WhatsApp message as read and optionally show typing indicator
 */
export async function markMessageAsRead(
  messageId: string,
  env: Env,
  showTyping: boolean = true
): Promise<void> {
  const url = `https://graph.facebook.com/v22.0/${env.SENDER_PHONE}/messages`;

  const payload: {
    messaging_product: string;
    status: string;
    message_id: string;
    typing_indicator?: { type: string };
  } = {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  };

  // Add typing indicator while agent is processing
  if (showTyping) {
    payload.typing_indicator = { type: 'text' };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.FACEBOOK_AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.warn('Failed to mark message as read:', await response.text());
  }
}

