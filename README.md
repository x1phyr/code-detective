# 代码侦探 🕵️ Code Detective

把 AI 生成的功能地图变成可点击的源码导读：调用关系、源码跳转与相关代码高亮。

AI 负责分析功能、产出地图 JSON；插件负责严格校验、渲染地图、跳转到真实源码并高亮相关范围。地图由谁生成都一样——插件内置的 AI、Copilot Chat，或者你手写的 JSON，最终都走同一套校验与展示链路。

要求 VS Code **1.95 或以上**，仅支持桌面版本的本地工作区。

## 安装与上手

从源码构建出的安装包在 `artifacts/code-detective-0.2.0.vsix`：

1. 在 VS Code 中执行 `Extensions: Install from VSIX...`，选择该文件。
2. 打开一个包含 `.code-detective/maps/*.json` 的工作区（仓库内的示例是 `examples/bag-demo`）。
3. 执行 **代码侦探: 打开地图**，选择地图即可浏览。

想先用示例体验，直接以 `examples/bag-demo` 作为工作区根目录打开即可，里面的地图已经可以直接加载。

## 能做什么

- **地图浏览**：节点按 `事件` / `函数` / `条件` / `步骤` 分类着色，支持缩放、平移、适应窗口、分支、循环、自环与平行边。
- **源码定位**：点击节点跳到实现，点击连线跳到调用或关系所在位置；同一处有多个来源时列出候选，由你选择。
- **两层高亮**：相关范围与当前选择分别高亮，同文件多个可见编辑器会各自应用。
- **顺序导读**：按 `walkthrough` 步骤前进/后退，也可随时停止并清除装饰，不影响文件本身。
- **状态恢复**：重开面板回到上次打开的地图；地图内容变化时重新布局。
- **主题跟随**：配色取自 VS Code 注入的 `--vscode-*` 变量，支持深色、浅色与高对比度。

插件不会推导调用关系。图中的结论来自地图作者；文本锚点只用于恢复位置，不代表分析结论仍然成立。

## 生成地图

### 1. 用内置 AI

在地图面板点 **AI 生成**，或执行 **代码侦探: 用 AI 生成地图**：选择 AI 服务 → 描述想了解的功能 → 插件附带当前文件与选中节点的源码 → AI 返回 JSON → 校验（失败自动带错误重试一次）→ 写入 `.code-detective/maps/` → 直接打开。

内置三种通道，默认 `auto` 按顺序探测，**代码默认不离开本机**：

| 通道 | 适用工具 |
| --- | --- |
| OpenAI 兼容 | Ollama、LM Studio、llama.cpp / vLLM、LocalAI |
| 本地 CLI | `claude -p`、`codex exec` 等已登录的 CLI agent（提示词走 stdin，不经 shell） |
| VS Code 语言模型 | 通过 `vscode.lm` 调用已安装的模型（如 Copilot Chat） |

### 2. 在 Copilot Chat 里生成

安装 Copilot Chat 后可以直接把探索调用链交给聊天窗口：

- `@detective <话题>`：先用 `#codeDetectiveSearch` / `#codeDetectiveRead` 读真实源码，再经 `#codeDetectiveCreateMap` 提交结构化流程，插件补全锚点、校验并打开地图。
- `@detective /map <话题>`：同上，显式走地图生成。
- `@detective /open`、`@detective /next`、`@detective /help`：打开地图、导读下一步、查看用法。

Agent 模式下也可以直接引用 `#codeDetectiveCreateMap`，把已有探索结果落成地图。模型只写 `file` / `startLine` / `endLine`，`anchorText` 由插件按真实文件生成；引用不存在文件的来源会被裁掉并在结果中列出。

### 3. 交给任意编码 AI

在项目根目录创建 `.code-detective/maps/`，执行 **代码侦探: 复制 AI 地图生成提示词**，把规范连同话题交给现有 AI。AI 写入有效 JSON 后地图列表会自动更新。

如果保存到一半或写出了不合法的版本，插件会在地图列表里把它标记为错误项并保留上一次有效内容；改好文件后列表会自动刷新。

## 地图格式

地图是工作区根目录 `.code-detective/maps/<id>.json` 下的单个 JSON 文件，`schemaVersion` 为 `1`，主要由四部分组成：

- `sources`：`file`（工作区相对路径）、`startLine`、`endLine`，可选 `anchorText`（完整整行文本，用于恢复位置）。
- `nodes`：id、`label`、分类 `kind`、`sourceIds`。
- `edges`：id、`label`、起止节点、关系类型 `kind`。
- `walkthrough`：可选的阅读步骤，引用已存在的节点与连线 id。

校验是严格的：JSON 重复键、未知字段、越界行号、越界路径、重复或悬空引用都会导致地图被拒绝，并给出具体位置。装好插件后编辑地图文件也会获得 JSON Schema 补全与提示（见 [schemas/code-map-v1.schema.json](schemas/code-map-v1.schema.json)）。

## 设置

```json
{
  "codeDetective.ai.provider": "auto",
  "codeDetective.ai.baseUrl": "http://127.0.0.1:11434/v1",
  "codeDetective.ai.model": "qwen2.5-coder:14b",
  "codeDetective.ai.cli.command": "claude",
  "codeDetective.ai.cli.args": ["-p"],
  "codeDetective.ai.allowRemote": false
}
```

| 设置 | 说明 |
| --- | --- |
| `codeDetective.ai.provider` | `auto` / `openai-compatible` / `cli` / `vscode-lm`，默认依次尝试 |
| `codeDetective.ai.baseUrl` | OpenAI 兼容地址，Ollama 默认 `http://127.0.0.1:11434/v1` |
| `codeDetective.ai.model` | 模型名，留空用服务默认模型 |
| `codeDetective.ai.cli.command` / `.args` | 本地 CLI 与参数，Claude Code 用 `-p`，Codex 用 `exec` |
| `codeDetective.ai.vscodeLm.vendor` / `.family` | `vscode-lm` 通道的模型筛选 |
| `codeDetective.ai.allowRemote` | 允许非本机地址，默认关闭 |
| `codeDetective.ai.timeoutMs` | 单次请求超时，默认 180 秒 |

- **代码侦探: 选择 AI 服务** 会探测本机端口并列出可用模型，选中后记住选择。
- API Key 存在 VS Code SecretStorage（**代码侦探: 设置 AI 服务 API Key**），不写入设置文件；本地模型通常不需要。
- `auto` 的回退顺序：已选好模型的地址 → 本机探测 → 本地 CLI → VS Code 语言模型；只填地址不选模型不会卡住后续通道。

## 命令

| 命令 | 用途 |
| --- | --- |
| `代码侦探: 打开地图` | 选择并打开工作区中的地图 |
| `代码侦探: 重新扫描地图` | 重新发现地图文件 |
| `代码侦探: 开始导读` / `下一步` / `上一步` / `停止导读` | 按步骤阅读 |
| `代码侦探: 切换相关代码高亮` / `清除高亮` | 控制编辑器装饰 |
| `代码侦探: 用 AI 生成地图` | 内置 AI 生成 |
| `代码侦探: 选择 AI 服务` / `设置 AI 服务 API Key` / `取消 AI 任务` | AI 配置与取消 |
| `代码侦探: 复制 AI 地图生成提示词` | 交给外部 AI |
| `代码侦探: 查看地图格式与使用说明` | 打开本文件 |

## 已知限制

- 只支持桌面 VS Code 的本地工作区；远程工作区、虚拟工作区以及 Cursor 等衍生编辑器未做适配。
- 节点位置由布局计算，不可拖动，地图不会保存坐标。
- Webview 的浏览器预览只是开发用的模拟环境（右侧源码组为只读模拟），真实插件使用 VS Code 原生编辑器。

## 开发

需要 Node.js **20.19+ 或 22.12+** 与 npm。

```sh
npm ci
npm run check        # 类型检查 + 单元测试 + 构建
npm run package      # 生成 artifacts/code-detective-0.2.0.vsix
```

| 命令 | 用途 |
| --- | --- |
| `npm run typecheck` | 检查扩展、Webview、测试与示例的 TypeScript |
| `npm test` | 核心、Host 输入边界与 Controller 模拟测试 |
| `npm run test:integration` | 在 Extension Host 中验证命令与工具注册 |
| `npm run build` | 输出 `dist/extension.cjs` 与 `dist/webview/` |
| `npm run dev` | 浏览器中的 Webview 交互预览 |

用源码调试时执行 `npm run build`（或让 F5 的 preLaunchTask 触发），选择 **运行代码侦探** 会在 Extension Development Host 中以 `examples/bag-demo` 打开；**运行代码侦探（当前工作区）** 则使用你当前打开的项目。

浏览器预览通过 `webview/preview.ts` 用示例数据模拟 Host 消息，并套了一层 VS Code 工作台外壳（`webview/src/preview-shell.ts`），状态栏左侧的色块按钮可循环切换 Dark / Light / High Contrast。预览仅按 `import.meta.env.DEV` 动态加载，不会进入 VSIX。

## 工程结构

| 路径 | 职责 |
| --- | --- |
| `src/extension.ts` | 扩展激活与退出 |
| `src/core/` | 地图校验、来源位置匹配、选择状态 |
| `src/host/` | 工作区文件、消息、源码导航、高亮、持久化与 Chat 集成 |
| `src/ai/` | AI 通道、提示词、草稿收敛与写盘 |
| `shared/` | 地图类型与 Webview 消息协议 |
| `webview/src/` | Vue 地图、详情与导读界面 |
| `schemas/` | v1 JSON Schema（随插件注册给地图文件） |
| `examples/bag-demo/` | 可直接运行的背包示例与示例地图 |
| `tests/` | 单元测试与 Extension Host 集成测试 |

## 状态

当前版本 **0.2.0**，处于初步开发阶段，变更见 [CHANGELOG.md](CHANGELOG.md)。项目以 `UNLICENSED` 发布，`publisher` 仍是本地开发标识 `code-detective-dev`。
