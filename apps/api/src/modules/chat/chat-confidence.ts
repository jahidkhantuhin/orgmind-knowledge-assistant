import { LOW_CONFIDENCE_ANSWER } from './prompt.builder.js';

export function isLowConfidenceAnswer(input: {
  retrievalHadNoCitations: boolean;
  usedCitationCount: number;
  answer: string;
}): boolean {
  return (
    input.retrievalHadNoCitations ||
    input.usedCitationCount === 0 ||
    input.answer.trim() === LOW_CONFIDENCE_ANSWER
  );
}
