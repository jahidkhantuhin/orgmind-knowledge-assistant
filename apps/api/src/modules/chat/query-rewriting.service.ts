import { generateText } from 'ai';
import { chatModelProvider } from './chat-model.provider.js';

export interface QueryRewriter {
  rewrite(_query: string): Promise<string>;
}

export type QueryRewriteGenerator = (_query: string) => Promise<string>;

export function createQueryRewritingService(generate: QueryRewriteGenerator): QueryRewriter {
  return {
    async rewrite(query) {
      const rewritten = (await generate(query)).trim().replace(/^\s*["'`]|["'`]\s*$/g, '');
      return rewritten.length > 0 && rewritten.length <= 500 ? rewritten : query;
    },
  };
}

export const queryRewritingService = createQueryRewritingService(async (query) => {
  const result = await generateText({
    model: chatModelProvider.getModel(),
    system:
      'Rewrite the user question as one concise standalone search query for company documents. Preserve names, dates, numbers, and intent. Do not answer it. Return only the rewritten query.',
    prompt: query,
    maxOutputTokens: 96,
    temperature: 0,
    maxRetries: 1,
  });
  return result.text;
});
