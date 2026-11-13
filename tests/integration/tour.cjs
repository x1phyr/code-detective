const assert = require('node:assert/strict');
const vscode = require('vscode');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, label, timeout = 5000) {
  const started = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - started > timeout) assert.fail(`等待超时：${label}`);
    await wait(50);
  }
}

const activeFile = () => vscode.window.activeTextEditor?.document.uri.path.split('/').pop();
const activeLine = () => (vscode.window.activeTextEditor?.selection.active.line ?? -1) + 1;

/** 在 login-demo 工作区里走一遍编辑器内导读：主线前进、走岔路、回来、后退、结束。 */
exports.run = async function run() {
  const extension = vscode.extensions.getExtension('code-detective-dev.code-detective');
  assert.ok(extension, '扩展应已加载');
  await extension.activate();
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, '应打开 login-demo 工作区');

  await vscode.commands.executeCommand('codeDetective.refreshMaps');
  await vscode.commands.executeCommand('codeDetective.openMap', `${folder.uri.toString()}::login-demo`);

  await vscode.commands.executeCommand('codeDetective.startWalkthrough');
  await until(() => activeFile() === 'login-controller.ts', '第 1 步打开 login-controller.ts');
  assert.equal(activeLine(), 6, '第 1 步定位到 onSubmit');

  await vscode.commands.executeCommand('codeDetective.nextStep');
  await until(() => activeFile() === 'validate.ts', '第 2 步打开 validate.ts');
  assert.equal(activeLine(), 7, '第 2 步只指向验证码那一行');

  await vscode.commands.executeCommand('codeDetective.tourBranch', 'w.captcha');
  await until(() => activeLine() === 17, '岔路定位到 recordFailure');

  // 岔路里“下一步” = 回到出发点。
  await vscode.commands.executeCommand('codeDetective.nextStep');
  await until(() => activeLine() === 7, '岔路看完回到第 2 步');

  await vscode.commands.executeCommand('codeDetective.nextStep');
  await until(() => activeFile() === 'auth-service.ts' && activeLine() === 8, '第 3 步打开缓存判断');

  await vscode.commands.executeCommand('codeDetective.previousStep');
  await until(() => activeFile() === 'validate.ts', '后退回到第 2 步');

  await vscode.commands.executeCommand('codeDetective.stopWalkthrough');
  await wait(200);
};
