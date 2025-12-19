import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModelV1 } from "ai";

const DEFAULT_MODELS = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  openrouter: "anthropic/claude-sonnet-4",
  opencode: "claude-sonnet-4",
} as const;

type ProviderType = "anthropic" | "openai" | "openrouter" | "opencode";

/**
 * Creates an AI model based on available API keys.
 * Priority: Anthropic > OpenAI > OpenRouter > OpenCode
 *
 * Set the MODEL env var to override the default model for your provider.
 *
 * Supports any provider available in the Vercel AI SDK.
 * See: https://sdk.vercel.ai/providers/ai-sdk-providers
 */
export function createModel(env: Env): { model: LanguageModelV1; provider: ProviderType } {
  const modelOverride = env.MODEL;

  if (env.ANTHROPIC_API_KEY) {
    const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
    return {
      model: anthropic(modelOverride ?? DEFAULT_MODELS.anthropic),
      provider: "anthropic",
    };
  }

  if (env.OPENAI_API_KEY) {
    const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
    return {
      model: openai(modelOverride ?? DEFAULT_MODELS.openai),
      provider: "openai",
    };
  }

  if (env.OPENROUTER_API_KEY) {
    const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY });
    return {
      model: openrouter(modelOverride ?? DEFAULT_MODELS.openrouter),
      provider: "openrouter",
    };
  }

  if (env.OPENCODE_API_KEY) {
    const opencode = createOpenAICompatible({
      name: "opencode",
      apiKey: env.OPENCODE_API_KEY,
      baseURL: "https://opencode.ai/zen/v1",
    });
    return {
      model: opencode(modelOverride ?? DEFAULT_MODELS.opencode),
      provider: "opencode",
    };
  }

  throw new Error(
    "No API key found. Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, or OPENCODE_API_KEY"
  );
}
