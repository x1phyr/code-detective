import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

function attribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = randomBytes(24).toString('base64');
  const root = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(root, 'index.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(root, 'style.css'));
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
    `worker-src ${webview.cspSource} blob:`,
    "connect-src 'none'",
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${attribute(csp)}">
<title>代码侦探 · Code Detective</title>
<link rel="stylesheet" href="${attribute(styleUri.toString())}">
</head><body><div id="app"></div>
<script nonce="${nonce}" type="module" src="${attribute(scriptUri.toString())}"></script>
</body></html>`;
}
