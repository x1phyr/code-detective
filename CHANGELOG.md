# 更新记录

## 0.2.0 — 未发布

- 新增 Copilot Chat 集成：`@detective` 参与者（`/map`、`/open`、`/next`、`/help`）把探索调用链的工作交给 chat，模型用 `codeDetective_searchSources` / `codeDetective_readSource` 读真实源码后调用 `codeDetective_createMap` 提交结构化流程，插件校验并直接打开地图。
- 新增 `contributes.chatParticipants` 与 `contributes.languageModelTools`（三个工具均可在 agent 模式被引用），并补齐对应 `onChatParticipant` / `onLanguageModelTool` 激活事件。
- 地图草稿的 `anchorText` 改由插件按真实文件生成：模型只写 `file` / `startLine` / `endLine`，引用不可读文件的来源、节点、连线、步骤会被裁剪移除并在结果中列出，避免整张地图因抄错文本而失败。
- `codeDetective.openMap` 支持带 `mapKey` 参数调用，用于聊天窗口的“打开地图”按钮与工具结果。
- 抽出共用的 `writeMapFile`，内置 AI 生成与 chat 提交走同一套递增命名与写盘逻辑。
- 新增内置 AI 生成：OpenAI 兼容本地服务（Ollama / LM Studio / llama.cpp / vLLM / LocalAI）、本地 CLI agent（`claude -p`、`codex exec`）、`vscode.lm`，`auto` 自动探测。
- 地图 Webview 增加「AI 生成」面板：选择服务、输入话题、流式进度、取消、生成后直接打开。
- 生成结果先经 `parseMap` 严格校验，失败时把错误回灌重试一次；重复生成自动递增 id 与文件名。
- 默认只允许回环地址，API Key 存 SecretStorage；新增 `codeDetective.ai.*` 设置与四个命令。
- `timeoutMs` 对 HTTP 通道同样生效（超时报 `AI_TIMEOUT`，取消报 `AI_CANCELLED`）；`auto` 回退顺序修正为“已配置模型的地址 → 本机探测 → CLI → `vscode.lm`”，只填地址不选模型不再吞掉后续通道。
- 生成地图的草稿会先收敛成合法形状：`id` 统一规范化、超长文本裁剪到 200 字、重复/畸形来源与节点被丢弃而不是抛出 `TypeError`，重复 `sourceIds` 自动去重。
- webview 传来的文件路径改用与校验器一致的规则，中文目录、空格与 `@scope` 文件名不再被误判为越界。
- 重开面板会恢复上次打开的地图；地图内容被改写时按新内容重算布局。高对比度浅色主题使用浅色原生控件。
- 地图 Webview 改用 VS Code 主题变量（含高对比度），按钮、输入框、列表选中态、滚动条与编辑器保持一致；面板折叠改用容器查询，避免窄分栏下误判。
- `npm run dev` 的浏览器预览增加 VS Code 工作台外壳：活动栏、标签页、面包屑、只读源码组与状态栏，并支持 Dark / Light / High Contrast 主题切换。
- 地图节点改为固定布局：禁止拖动，移除“自动布局”按钮并改为“适应窗口”；视图状态不再保存节点坐标，`ui.patch` 不再接受 `positions`。

## 0.1.0 — 2026-11-11

- 建立 VS Code 扩展、Vue Webview 与 v1 地图协议。
- 实现调用地图、源码跳转、相关范围高亮与顺序导读。
- 加入文件监听、最后有效地图、位置状态及工作区会话保存。
- 加入背包示例、AI 生成规范和自动测试。
- 采用第 2 张设计稿的深色地图方向；浏览器视觉验收与真实 Extension Host 验收待完成。
