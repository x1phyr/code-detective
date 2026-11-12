const path = require('node:path');
const fs = require('node:fs');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'index.cjs');
  const workspace = path.resolve(extensionDevelopmentPath, 'examples', 'bag-demo');

  // 有些 VS Code 构建（如 Insider / 本地测试包）的可执行文件名不是 Electron。
  const cached = path.resolve(extensionDevelopmentPath, '.vscode-test', 'vscode-darwin-arm64-1.146.0');
  const executable = path.join(cached, 'Visual Studio Code.app', 'Contents', 'MacOS', 'Code');
  const vscodeExecutablePath = fs.existsSync(executable) ? executable : undefined;

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      vscodeExecutablePath,
      launchArgs: [workspace, '--disable-extensions'],
    });
  } catch (error) {
    console.error('集成测试失败:', error);
    process.exit(1);
  }
}

void main();
