/**
 * Conversation Durable Object
 * 
 * Each WhatsApp conversation gets its own Durable Object instance.
 * This provides:
 * - Isolated conversation state per user
 * - Persistent message history across requests
 * - AI agent processing with conversation context
 * 
 * The Durable Object stores conversation history in this.ctx.storage,
 * which persists across requests and Worker instances.
 */

import { DurableObject } from 'cloudflare:workers';
import { generateText, CoreMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { Env } from '../env';
import { Message, WhatsAppWebhookPayload } from '../types';
import { sendTextMessage, markMessageAsRead } from '../services/whatsapp';

// Simple system prompt - customize this for your use case
const SYSTEM_PROMPT = `You are a helpful AI assistant communicating via WhatsApp.
Be friendly, concise, and helpful. Keep your responses conversational and not too long.`;

export class ConversationDurableObject extends DurableObject<Env> {
  // Maximum number of messages to keep in conversation history
  private static readonly MAX_MESSAGES = 20;

  /**
   * Main entry point: Process a WhatsApp webhook message
   * Called by the Worker for each incoming message
   */
  async processMessage(
    webhookData: WhatsAppWebhookPayload
  ): Promise<{ success: boolean; error?: string; response?: string }> {
    try {
      // Parse webhook payload
      const entry = webhookData.entry?.[0];
      const changes = entry?.changes?.[0];

      if (!changes?.value?.messages || !changes?.value?.contacts) {
        return { success: false, error: 'Invalid webhook data' };
      }

      const value = changes.value;
      const contact = value.contacts?.[0];
      const message = value.messages?.[0];

      if (!contact || !message) {
        return { success: false, error: 'Missing contact or message' };
      }

      // Extract user info
      const waId = contact.wa_id;
      const messageId = message.id;
      const messageTimestamp = new Date(parseInt(message.timestamp) * 1000);

      // Send read receipt
      try {
        await markMessageAsRead(messageId, this.env);
      } catch (error) {
        console.warn('Failed to send read receipt:', error);
      }

      // Only process text messages for this minimal example
      if (message.type !== 'text' || !message.text?.body) {
        await sendTextMessage(
          'Sorry, I can only process text messages in this demo.',
          waId,
          this.env
        );
        return { success: false, error: 'Unsupported message type' };
      }

      const content = message.text.body;
      console.log('💬 User:', content);

      // Get conversation history from Durable Object storage
      const history = await this.getHistory();

      // Create user message
      const userMessage: Message = {
        role: 'user',
        content: content,
        timestamp: messageTimestamp,
      };

      // Add to history
      await this.addMessage(userMessage);

      // Generate AI response with full conversation context
      const response = await this.generateResponse([...history, userMessage]);

      console.log('🤖 Assistant:', response.substring(0, 100));

      // Create assistant message
      const assistantMessage: Message = {
        role: 'assistant',
        content: response,
        timestamp: new Date(),
      };

      // Add to history
      await this.addMessage(assistantMessage);

      // Send response via WhatsApp
      try {
        await sendTextMessage(response, waId, this.env);
        console.log('✅ Message sent');
      } catch (error) {
        console.error('Failed to send WhatsApp message:', error);
        return { success: false, error: 'Failed to send WhatsApp message' };
      }

      return { success: true, response };
    } catch (error) {
      console.error('Error processing message:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Generate AI response using OpenAI
   */
  private async generateResponse(messages: Message[]): Promise<string> {
    try {
      // Convert to AI SDK format
      const coreMessages: CoreMessage[] = messages.map((msg) => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      }));

      // Initialize OpenAI client
      const openai = createOpenAI({
        apiKey: this.env.OPENAI_API_KEY,
      });

      // Generate response
      const result = await generateText({
        model: openai('gpt-5-mini'),
        system: SYSTEM_PROMPT,
        messages: coreMessages,
        temperature: 1,
      });

      return result.text || "I'm sorry, I couldn't generate a response.";
    } catch (error) {
      console.error('Error generating response:', error);
      return 'I apologize, but I encountered an error. Please try again.';
    }
  }

  /**
   * Get conversation history from Durable Object storage
   */
  private async getHistory(): Promise<Message[]> {
    const history = await this.ctx.storage.get<Message[]>('messages');
    return history || [];
  }

  /**
   * Add a message to conversation history
   * Automatically trims to MAX_MESSAGES to prevent unbounded growth
   */
  private async addMessage(message: Message): Promise<void> {
    const history = await this.getHistory();
    history.push(message);

    // Keep only the most recent messages
    const trimmedHistory =
      history.length > ConversationDurableObject.MAX_MESSAGES
        ? history.slice(-ConversationDurableObject.MAX_MESSAGES)
        : history;

    await this.ctx.storage.put('messages', trimmedHistory);
  }

  /**
   * Clear conversation history (useful for testing)
   */
  async clearHistory(): Promise<void> {
    await this.ctx.storage.delete('messages');
  }
}

