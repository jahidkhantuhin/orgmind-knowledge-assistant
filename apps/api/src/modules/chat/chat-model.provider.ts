import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import { env } from '../../config/env.js';

export interface ChatModelProvider {
  readonly modelId: string;
  getModel(): LanguageModel;
}

export const chatModelProvider: ChatModelProvider = {
  modelId: env.CHAT_MODEL,
  getModel() {
    if (!env.GOOGLE_API_KEY) throw new Error('Set GOOGLE_API_KEY before starting a chat.');
    return createGoogleGenerativeAI({ apiKey: env.GOOGLE_API_KEY })(env.CHAT_MODEL);
  },
};
