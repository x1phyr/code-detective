import type { Message } from '../index';

/** ai 区域的文案。key 统一以 `ai.` 开头。 */
export const ai = {
  'ai.sourceFile': { 'zh-CN': '源码文件', en: 'source file' },
  'ai.searchPattern': { 'zh-CN': '搜索模式', en: 'pattern' },
  'ai.unknownAgent': { 'zh-CN': '未知的 agent：{agent}。可选：{options}。', en: 'Unknown agent: {agent}. Available: {options}.' },
  'ai.listSeparator': { 'zh-CN': '、', en: ', ' },
  'ai.noJsonInResponse': { 'zh-CN': '没有在响应中找到合法的 JSON 对象。', en: 'No valid JSON object found in the response.' },
  'ai.noJsonInReply': { 'zh-CN': '没有在 agent 的回复中找到合法的 JSON 对象。', en: "No valid JSON object found in the agent's reply." },
  'ai.agentReading': { 'zh-CN': 'agent 正在阅读源码', en: 'The agent is reading the source' },
  'ai.invalidMap': { 'zh-CN': 'agent 给出的地图未通过校验：{issue}', en: 'The map from the agent failed validation: {issue}' },
  'ai.unknownReason': { 'zh-CN': '未知原因', en: 'unknown reason' },
  'ai.fileNameConflict': { 'zh-CN': '地图文件名冲突过多：{base} 到 {id} 都已存在，请先清理 .code-detective/maps/。', en: 'Too many map file name conflicts: {base} through {id} all exist. Clean up .code-detective/maps/ first.' },
  'ai.unparsableOutput': { 'zh-CN': '无法解析 {agent} 的输出。{detail}', en: 'Cannot parse the output of {agent}. {detail}' },
  'ai.agentReturnedError': { 'zh-CN': '{agent} 返回错误：{error}', en: '{agent} returned an error: {error}' },
  'ai.cliStartFailed': { 'zh-CN': '无法启动 {command}：{error}。请确认已安装并在 PATH 中。', en: 'Cannot start {command}: {error}. Make sure it is installed and on PATH.' },
  'ai.cliTimeout': { 'zh-CN': '{command} 超过 {seconds} 秒未完成，已终止。', en: '{command} did not finish within {seconds} seconds and was terminated.' },
  'ai.cancelled': { 'zh-CN': 'agent 请求已取消。', en: 'The agent request was cancelled.' },
  'ai.cliMissing': { 'zh-CN': '没有找到 {command}，请先安装 {agent} 或修改 codeDetective.ai.cli.command。', en: '{command} not found. Install {agent} or change codeDetective.ai.cli.command.' },
  'ai.cliRunFailed': { 'zh-CN': '无法运行 {command}：{error}', en: 'Cannot run {command}: {error}' },
  'ai.cliExitCode': { 'zh-CN': '{command} 退出码 {code}。{stderr}', en: '{command} exited with code {code}. {stderr}' },
  'ai.copilotUnavailable': {
    'zh-CN': '未找到可用的 GitHub Copilot CLI 或 VS Code 语言模型（请安装 copilot CLI、登录 GitHub Copilot，或切换到 agy / codex / claude）。',
    en: 'No GitHub Copilot CLI or VS Code language model is available (install the copilot CLI, sign in to GitHub Copilot, or switch to agy / codex / claude).',
  },
} satisfies Record<`ai.${string}`, Message>;
