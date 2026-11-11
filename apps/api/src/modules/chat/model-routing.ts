import { env } from '../../config/env.js';
import { defaultFastModelId } from './chat-model.provider.js';

export type ModelPreference = 'auto' | 'fast' | 'strong';
export type ChatModelRoute = {
  preference: ModelPreference;
  route: 'fast' | 'strong';
  modelId: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

function needsStrongerModel(question: string): boolean {
  return (
    question.length >= 180 ||
    (question.match(/\?/g)?.length ?? 0) > 1 ||
    /\b(compare|contrast|analy[sz]e|reason|evaluate|trade[- ]?offs?|multiple|step[- ]by[- ]step|why does|how do these|summari[sz]e .* and)\b/i.test(
      question,
    )
  );
}

export function routeChatModel(
  question: string,
  preference: ModelPreference = 'auto',
): ChatModelRoute {
  const route =
    preference === 'fast'
      ? 'fast'
      : preference === 'strong'
        ? 'strong'
        : needsStrongerModel(question)
          ? 'strong'
          : 'fast';
  const modelId = route === 'fast' ? defaultFastModelId() : env.CHAT_STRONG_MODEL;
  return {
    preference,
    route,
    modelId,
    inputUsdPerMillion:
      env.CHAT_PROVIDER === 'ollama'
        ? 0
        : route === 'fast'
          ? env.GEMINI_INPUT_COST_USD_PER_MILLION_TOKENS
          : env.GEMINI_STRONG_INPUT_COST_USD_PER_MILLION_TOKENS,
    outputUsdPerMillion:
      env.CHAT_PROVIDER === 'ollama'
        ? 0
        : route === 'fast'
          ? env.GEMINI_OUTPUT_COST_USD_PER_MILLION_TOKENS
          : env.GEMINI_STRONG_OUTPUT_COST_USD_PER_MILLION_TOKENS,
  };
}
