export function estimateTokenCostUsd(
  inputTokens: number,
  outputTokens: number,
  inputUsdPerMillion: number,
  outputUsdPerMillion: number,
): number {
  return (inputTokens * inputUsdPerMillion + outputTokens * outputUsdPerMillion) / 1_000_000;
}
