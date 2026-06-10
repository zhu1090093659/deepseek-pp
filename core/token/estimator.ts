// Per DeepSeek's official guidance (https://api-docs.deepseek.com/quick_start/token_usage):
// 1 CJK character ~= 0.6 token, 1 ASCII character ~= 0.3 token.
export function estimateTokenUnits(text: string): number {
  let tokens = 0;
  for (const char of text) {
    tokens += char.charCodeAt(0) > 0x7F ? 0.6 : 0.3;
  }
  return tokens;
}

export function estimateTokens(text: string): number {
  return Math.ceil(estimateTokenUnits(text));
}
