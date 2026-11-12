const CODE_MODEL = /(coder|codestral|codegemma|deepseek|qwen|llama|mistral|starcoder|magicoder|granite|phi)/i;
const STRONG_CODE_MODEL = /coder|codegemma|starcoder|magicoder/i;

/**
 * Picks the most code-oriented model from a local server's catalogue, keeping
 * auto-detection deterministic: strong code models, then general code-capable
 * models, then whatever the server reports first.
 */
export function pickModel(models: readonly string[]): string | undefined {
  if (models.length === 0) return undefined;
  return models.find(model => STRONG_CODE_MODEL.test(model))
    ?? models.find(model => CODE_MODEL.test(model))
    ?? models[0];
}
