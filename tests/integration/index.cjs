const assert = require('node:assert/strict');
const vscode = require('vscode');

const COMMANDS = [
  'codeDetective.openMap',
  'codeDetective.refreshMaps',
  'codeDetective.startWalkthrough',
  'codeDetective.nextStep',
  'codeDetective.previousStep',
  'codeDetective.stopWalkthrough',
  'codeDetective.clearHighlights',
  'codeDetective.toggleHighlights',
  'codeDetective.copyAuthoringPrompt',
  'codeDetective.openHelp',
  'codeDetective.generateMap',
  'codeDetective.chooseAiProvider',
  'codeDetective.cancelAi',
  'codeDetective.fitView',
  'codeDetective.highlightsOn',
  'codeDetective.highlightsOff',
];

const TOOLS = ['codeDetective_searchSources', 'codeDetective_readSource', 'codeDetective_createMap'];

exports.run = async function run() {
  const extension = vscode.extensions.getExtension('code-detective-dev.code-detective');
  assert.ok(extension, '扩展应已加载');
  await extension.activate();

  const registered = new Set(await vscode.commands.getCommands(true));
  for (const command of COMMANDS) {
    assert.ok(registered.has(command), `命令未注册：${command}`);
  }

  const folders = vscode.workspace.workspaceFolders ?? [];
  assert.ok(folders.length > 0, '应打开示例工作区');

  const maps = await vscode.workspace.findFiles('**/.code-detective/maps/*.json', null, 5);
  assert.ok(maps.length > 0, '示例工作区应包含地图 JSON');

  const document = await vscode.workspace.openTextDocument(maps[0]);
  assert.ok(document.getText().includes('"schemaVersion": 1'), '地图应包含 schemaVersion');

  // 侧边栏视图：清单里声明在活动栏容器下，且 focus 命令能打开它。
  const views = extension.packageJSON?.contributes?.views?.codeDetective ?? [];
  assert.ok(views.some(view => view.id === 'codeDetective.mapView' && view.type === 'webview'), '应声明侧边栏 webview 视图');
  await vscode.commands.executeCommand('codeDetective.mapView.focus');

  await vscode.commands.executeCommand('codeDetective.refreshMaps');
  await new Promise(resolve => setTimeout(resolve, 500));

  const registeredTools = vscode.lm.tools.filter(tool => TOOLS.includes(tool.name));
  for (const name of TOOLS) {
    const info = registeredTools.find(tool => tool.name === name);
    assert.ok(info, `工具未注册：${name}`);
    assert.ok(info.inputSchema, `${name} 应声明 inputSchema`);
  }

  // `canBeReferencedInPrompt` 只在清单里生效，运行时通过 packageJSON 断言。
  const manifestTools = extension.packageJSON?.contributes?.languageModelTools ?? [];
  for (const name of TOOLS) {
    const declared = manifestTools.find(tool => tool.name === name);
    assert.ok(declared, `清单缺少工具：${name}`);
    assert.equal(declared.canBeReferencedInPrompt, true, `${name} 应可在 agent 模式引用`);
  }

  // 聊天参与者在没有 Copilot Chat 的测试实例里可能不可枚举，只做尽力校验。
  const participants = vscode.chat?.chatParticipants;
  if (participants) {
    const ids = Array.from(participants, participant => participant.id);
    assert.ok(ids.includes('code-detective.detective'), `聊天参与者未注册：${ids.join(', ')}`);
  }
};
