import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import { env } from '../../config/env.js';

export interface ChatModelProvider {
  readonly modelId: string;
  getModel(_modelId?: string): LanguageModel;
}

export const chatModelProvider: ChatModelProvider = {
  modelId: env.CHAT_MODEL,
  getModel(modelId = env.CHAT_MODEL) {
    if (!env.GOOGLE_API_KEY) throw new Error('Set GOOGLE_API_KEY before starting a chat.');
    return createGoogleGenerativeAI({ apiKey: env.GOOGLE_API_KEY })(modelId);
  },
};
