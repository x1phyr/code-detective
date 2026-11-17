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

/** 在 login-demo 工作区里验证侧栏带读与编辑器联动：主线启动、前进、后退，编辑器保持干净定位。 */
exports.run = async function run() {
  const extension = vscode.extensions.getExtension('x1phyr.code-detective-guide');
  assert.ok(extension, '扩展应已加载');
  await extension.activate();
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, '应打开 login-demo 工作区');

  await vscode.commands.executeCommand('codeDetective.refreshMaps');
  await vscode.commands.executeCommand('codeDetective.openMap', `${folder.uri.toString()}::login-demo`);

  await vscode.commands.executeCommand('codeDetective.startWalkthrough');
  await until(() => activeFile() === 'login-controller.ts', '第 1 步打开 login-controller.ts');
  assert.equal(activeLine(), 7, '第 1 步定位到 validateForm 调用');

  await vscode.commands.executeCommand('codeDetective.nextStep');
  await until(() => activeFile() === 'validate.ts', '第 2 步打开 validate.ts');
  assert.equal(activeLine(), 5, '第 2 步定位到 validateForm 校验语句');

  await vscode.commands.executeCommand('codeDetective.nextStep');
  await until(() => activeFile() === 'auth-service.ts' && activeLine() === 8, '第 3 步打开缓存判断');

  await vscode.commands.executeCommand('codeDetective.previousStep');
  await until(() => activeFile() === 'validate.ts', '后退回到第 2 步');

  await wait(200);
};
