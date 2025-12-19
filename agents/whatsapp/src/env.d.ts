/**
 * Cloudflare Workers Environment Type Definitions
 * 
 * Defines the bindings and environment variables available in the Cloudflare Worker runtime.
 */

import { DurableObjectNamespace } from '@cloudflare/workers-types';
import { ConversationDurableObject } from './durable-objects/conversation';

export interface Env {
  // Durable Object binding
  CONVERSATIONS: DurableObjectNamespace<ConversationDurableObject>;
  
  // Environment variables / Secrets
  OPENAI_API_KEY: string;
  SENDER_PHONE: string;
  FACEBOOK_AUTH_TOKEN: string;
  WEBHOOK_VERIFY_TOKEN: string;
}

