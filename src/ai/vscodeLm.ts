import * as vscode from 'vscode';
import { AiError, type AiCompletionRequest, type AiProvider } from './types';

export interface VsCodeLmOptions {
  vendor: string;
  family: string;
}

/**
 * Routes through the host's `vscode.lm` API so the user's already-selected
 * chat model (Copilot or any future BYOK provider) can be reused.
 */
export class VsCodeLmProvider implements AiProvider {
  readonly id = 'vscode-lm';

  constructor(private readonly options: VsCodeLmOptions) {}

  get label(): string {
    return `VS Code 语言模型（${this.options.vendor || '任意'}）`;
  }

  async complete({ system, user, cancel, onProgress }: AiCompletionRequest): Promise<string> {
    const selector: vscode.LanguageModelChatSelector = {};
    if (this.options.vendor) selector.vendor = this.options.vendor;
    if (this.options.family) selector.family = this.options.family;
    const models = await vscode.lm.selectChatModels(selector);
    const model = models[0];
    if (!model) {
      throw new AiError('AI_NO_MODEL', 'VS Code 中没有可用的语言模型。请安装 Copilot Chat 或改用本地服务。');
    }

    const messages = [
      vscode.LanguageModelChatMessage.User(`${system}\n\n${user}`),
    ];
    try {
      const response = await model.sendRequest(messages, {
        justification: '读取工作区源码后生成代码地图',
      }, cancel as unknown as vscode.CancellationToken);
      let text = '';
      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          text += part.value;
          onProgress?.(text);
        }
      }
      return text;
    } catch (error) {
      if (error instanceof vscode.LanguageModelError) {
        throw new AiError('AI_LM_ERROR', `语言模型请求失败：${error.message}`);
      }
      throw error;
    }
  }
}

export async function countVsCodeLmModels(): Promise<number> {
  try {
    return (await vscode.lm.selectChatModels({})).length;
  } catch {
    return 0;
  }
}
