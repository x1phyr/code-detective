const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  // 在 VS Code 集成终端 / 扩展宿主里运行时会继承 ELECTRON_RUN_AS_NODE=1，
  // test-electron 会原样透传给子进程，导致 VS Code 以纯 Node 模式启动，
  // 把工作区路径当成脚本执行（Cannot find module .../examples/bag-demo）。
  delete process.env.ELECTRON_RUN_AS_NODE;

  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'index.cjs');
  const workspace = path.resolve(extensionDevelopmentPath, 'examples', 'bag-demo');

  try {
    // 复用 .vscode-test 缓存；离线时回落到本地已有版本。
    // 可用 VSCODE_TEST_VERSION 指定版本（如 1.95.0 验证 engines 下限）。
    await runTests({
      version: process.env.VSCODE_TEST_VERSION || undefined,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspace, '--disable-extensions'],
    });
  } catch (error) {
    console.error('集成测试失败:', error);
    process.exit(1);
  }
}

void main();
