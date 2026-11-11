import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import { env } from '../../config/env.js';
import { createOllamaLanguageModel } from './ollama-language-model.js';

export function defaultFastModelId(): string {
  return env.CHAT_FAST_MODEL || env.CHAT_MODEL;
}

export interface ChatModelProvider {
  readonly modelId: string;
  getModel(_modelId?: string): LanguageModel;
}

export const chatModelProvider: ChatModelProvider = {
  modelId: defaultFastModelId(),
  getModel(modelId = defaultFastModelId()) {
    if (env.CHAT_PROVIDER === 'ollama')
      return createOllamaLanguageModel(env.OLLAMA_BASE_URL, modelId);
    if (!env.GOOGLE_API_KEY) throw new Error('Set GOOGLE_API_KEY before starting a chat.');
    return createGoogleGenerativeAI({ apiKey: env.GOOGLE_API_KEY })(modelId);
  },
};
