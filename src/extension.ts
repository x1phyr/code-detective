import * as vscode from 'vscode';
import { DetectiveController } from './host/controller';
import { resolveLocale, setLocale } from '../shared/i18n';

let controller: DetectiveController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // 跟随 VS Code 显示语言：中文环境用中文，其余一律英文。
  setLocale(resolveLocale(vscode.env.language));
  controller = new DetectiveController(context);
  context.subscriptions.push(controller);
  await controller.start();
}

export async function deactivate(): Promise<void> {
  await controller?.shutdown();
  controller = undefined;
}
