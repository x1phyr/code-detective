import * as vscode from 'vscode';
import { DetectiveController } from './host/controller';

let controller: DetectiveController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  controller = new DetectiveController(context);
  context.subscriptions.push(controller);
  await controller.start();
}

export async function deactivate(): Promise<void> {
  await controller?.shutdown();
  controller = undefined;
}
