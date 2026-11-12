export interface AutoConfig {
  /** Configured OpenAI-compatible model name; empty means "not selected yet". */
  model: string;
  cliCommand: string;
}

export type AutoSource = 'configured-openai' | 'local-probe' | 'cli' | 'vscode-lm';

/**
 * Fallback order for the `auto` provider.
 *
 * An explicitly configured endpoint is only usable when a model is named —
 * posting to `/chat/completions` with an empty model always fails — so the
 * unmodelled endpoint must not swallow the CLI / `vscode.lm` fallbacks.
 */
export function autoPlan(config: AutoConfig): AutoSource[] {
  const plan: AutoSource[] = [];
  if (config.model.trim().length > 0) plan.push('configured-openai');
  plan.push('local-probe');
  if (config.cliCommand.trim().length > 0) plan.push('cli');
  plan.push('vscode-lm');
  return plan;
}
