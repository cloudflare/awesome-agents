/**
 * Type definitions for WhatsApp webhook payloads and messages
 */

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  role: MessageRole;
  content: string;
  timestamp: Date;
}

export interface WhatsAppContact {
  wa_id: string;
  profile?: {
    name: string;
  };
}

export interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: 'text' | 'audio' | 'image' | 'video';
  text?: {
    body: string;
  };
}

export interface WhatsAppWebhookPayload {
  entry: Array<{
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: WhatsAppContact[];
        messages?: WhatsAppMessage[];
      };
    }>;
  }>;
}

