# 代码侦探 🕵️ Code Detective

像一位熟手同事坐在你旁边，手把手带你读懂一段代码：**叙事化带读讲义为主角、粗粒度全景脉络图为辅助、VS Code 源码编辑器保持干净通透。**

要求 VS Code **1.95 或以上**，支持桌面版本的本地工作区。

## 核心交互设计

1. **📖 手风琴式带读主线（默认侧边栏视图）**
   - 顶部提供**贯穿案例**（例如“alice 输错 3 次密码后再登录”），用一条真实业务数据串起整条调用链。
   - 主线步骤垂直排布成手风琴时间轴：一次只展开当前精讲的一步，讲清**这段在做什么、为什么这样设计（Why）、容易踩的坑（Watch）、哪些细节可以先跳过（Skip）**。
   - **🔀 内嵌岔路（Aside）**：异常分支、退避重试、缓存兜底等支线以胶囊按钮挂在主线步骤下，点开就地阅读，收起即回主线，绝不迷路。
   - 走完最后一步给出**全局复盘与动手小练习**，检验是否真正读懂。
2. **🧼 干净克制的源码编辑器 + 柔和双向跟随**
   - 所有讲解、岔路、笔记与追问全部收敛在左侧导师面板中，**不在代码行间塞入评论框破坏代码排版**。
   - 编辑器内**仅高亮当前步骤（或脉络图临时窥探）对应的唯一代码段**，并在首行末尾附上一句简短行内批注（`← ...`）。
   - 当你在编辑器里自由翻看代码时，侧栏静默标出 `📍 光标在此` 并在底栏给出轻提示（可一键切到对应步骤或回到本步代码），绝不强抢你的阅读进度。
3. **💬 流式向老手追问 + 沉淀为笔记或新岔路**
   - 底部常驻追问框，在编辑器里框选一段代码后提问会自动附带选区上下文。
   - AI 流式输出回答，实时展示正在检索/阅读的文件足迹；回答中的 `` `path/file.ts:line` `` 渲染为可点击按钮，一键跳到对应源码行。
   - 有价值的解答可一键**存为本步笔记**或**存为新岔路**，直接持久化写回 `.code-detective/maps/<id>.json`。
4. **🗺️ 粗粒度调用脉络图（原地展开分组 + 独立宽屏页签）**
   - 聚焦函数/模块级粗粒度骨架（最多 1 层阶段分组 `parent`），分组框基于 ELK Compound Layout **原地展开/收起**，上下游始终同屏可见。
   - 节点右上角标注关联的带读步号徽章（如 `#1`、`#3–4`）；点击节点或连线触发**非破坏性源码窥探（Peek）**，不会冲掉你当前的带读进度；点标题栏 `↗` 可在独立编辑器页签中宽屏查看全景脉络图。
5. **✨ 就地发起带读与实时探索足迹**
   - 在任意函数或代码行上右键选择 **代码侦探：从此处开始带读**，自动锚定当前文件、行号与函数符号，在侧栏内嵌发起框里补充一句想搞懂的问题即可生成。
   - 生成过程中实时滚动展示 AI 搜索与阅读源码的足迹流。

## 快速上手

1. 安装构建产物 `artifacts/code-detective-0.2.0.vsix`（`Extensions: Install from VSIX...`），或按 `F5` 启动调试宿主窗口。
2. 打开示例工作区 `examples/login-demo` 或 `examples/bag-demo`。
3. 点击左侧活动栏的 **代码侦探** 图标打开导师带读面板：
   - 顶部书架下拉框可切换已有带读讲义，支持 `+ 新建`、`↻ 重生成`（原位覆盖更新）与 `🗑 删除`。
   - 快捷键 `⌥[` / `⌥]`（Windows / Linux 为 `Alt+[` / `Alt+]`）可快速切换上一步 / 下一步。

## 多通道 AI 引擎与非 VS Code 兼容

插件核心体验收敛在侧边栏导师面板与本地 Agent 体系中。**Cursor、Windsurf、Trae、Antigravity IDE、VSCodium** 等兼容编辑器可通过 VSIX 尝试安装；各分支的安装策略和 API 支持不同，需分别验证。若宿主编辑器不支持 `@detective`（`vscode.chat`）或 `vscode.lm`，插件会跳过聊天参与者注册，并由侧边栏内嵌 Agent 驱动生成与追问。

内置引擎按 **`copilot` → `agy` → `codex` → `claude`** 顺位排序；未显式固定引擎时，自动探测 PATH（含 macOS/Linux 常见桌面安装目录如 `~/.local/bin`、`/opt/homebrew/bin`）并选中首个可用引擎：

| 顺位 | 引擎 | `codeDetective.ai.agent` | 说明 |
| --- | --- | --- | --- |
| 1（默认） | GitHub Copilot | `copilot` | 优先调用本机 `copilot` CLI（`-s --no-ask-user --allow-all-tools --deny-tool write --deny-tool shell`，`stdin` 传入提示词）；VS Code 内未装 CLI 时无缝回退到 `vscode.lm` 语言模型 API（VS Code 中亦支持 `@detective`） |
| 2 | Antigravity (`agy`) | `agy` | `agy --output-format stream-json`（`stdin` 传入提示词），支持实时工具足迹与 `--conversation` 会话续接 |
| 3 | Codex CLI | `codex` | `codex exec --json --sandbox read-only --skip-git-repo-check`，只读沙箱探索与 `codex exec resume` 续接 |
| 4 | Claude Code | `claude` | `claude -p --output-format stream-json --verbose --allowedTools Read,Grep,Glob,LS`，支持实时工具足迹与 `--resume` 同会话修正/追问 |
| 扩展 | 自定义 CLI | `<custom-id>` | 在 `codeDetective.ai.cli.agents` 中声明 `{ id, label, command, args }` |

所有 CLI 调用均通过 `stdin` 传递提示词且 `shell: false`。Copilot、Codex 和 Claude 的内置参数限制了写入或可用工具；Antigravity 与自定义 CLI 的权限取决于其自身配置。

### 数据与隐私

AI 生成功能会把主题、提问和相关源码上下文交给所选 AI 引擎，由该引擎按自身账户与服务规则处理；使用本机 CLI 不代表模型在本机离线运行。使用前请确认所选引擎适合处理当前工作区代码。插件自身未实现独立遥测上报。

讲义、源码锚点与保存的问答笔记会写入工作区的 `.code-detective/maps/`，其中可能包含项目名称和源码片段。提交自己的业务项目或分享讲义前，请检查这些文件。

## 讲义 JSON 格式（Schema v1）

讲义保存在 `.code-detective/maps/<id>.json`（Schema 见 [schemas/code-map-v1.schema.json](schemas/code-map-v1.schema.json)）：

- `sources`：`file`（工作区规范相对路径）、`startLine`、`endLine`，可选 `anchorText`（整行锚点文本，代码行号漂移时自动重定位）、`note`（首行行尾批注）、`symbol`（所属函数或类方法）、`variantLabel`（并列实现标签）。
- `walkthrough`（必填，至少 1 条主线步骤）：每步包含 `id`、`title`、`nodeIds`、`edgeIds`，推荐填写 `sourceId`、`description`、`why`、`watch`、`skip`、`example`；`aside: true` 表示支线岔路（由主线步骤的 `branches` 引用）；`notes` 保存用户沉淀的问答笔记。
- `tour`：可选的全局导读设定：`example`（贯穿案例）、`recap`（复盘总结）、`exercise`（课后小练习）。
- `nodes` / `edges`：6–15 个函数/模块级粗粒度节点与调用连线；可选 `parent` 指向顶层阶段节点（最多允许 1 层阶段分组），可选 `branch` 标记异常/旁路分支（默认收起为 `+N`）。节点用 `sourceMode: "slices" | "variants"` 区分同函数切片与并列实现；连线可用 `kind: "delegated"` 和有序 `via` 来源列表表达中间转发层，点击后查看完整调用链。

完整示例可参考 [login-demo.json](examples/login-demo/.code-detective/maps/login-demo.json) 与 [bag-demo.json](examples/bag-demo/.code-detective/maps/bag-demo.json)。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `代码侦探: 打开带读讲义` | 选择并打开工作区中的带读讲义 |
| `代码侦探: 从此处开始带读` | 以当前编辑器光标/选区为锚点生成带读讲义（亦见编辑器右键菜单） |
| `代码侦探: 用 AI 生成带读讲义` | 打开侧栏内嵌发起框生成新讲义 |
| `代码侦探: 在新页签打开全景脉络图` | 在独立宽屏编辑器页签中打开调用脉络图并与侧栏联动 |
| `代码侦探: 开始带读` / `下一步` / `上一步` | 按主线推进阅读 |
| `代码侦探: 切换代码高亮` / `清除高亮` | 控制编辑器内当前步骤代码段高亮 |
| `代码侦探: 选择 AI 引擎` / `取消 AI 任务` | 切换 AI 引擎或中止进行中的任务 |
| `代码侦探: 复制 AI 带读生成提示词` | 复制完整 Schema 提示词给任意外部 AI |

## 开发与验证

需要 Node.js **22.12+** 与 npm：

```sh
npm ci
npm run check        # 类型检查 + 单元测试 + 生产构建
npm run dev          # 浏览器内交互预览（默认 login-demo，加 ?map=bag 切换背包示例）
npm run package      # 打包 artifacts/code-detective-0.2.0.vsix
```

| 目录 | 职责 |
| --- | --- |
| `shared/` | 核心数据结构、双向协议与中英双语词典（`shared/i18n/`） |
| `src/core/` | JSON 严格校验、草稿收敛补锚点、单层复合图投影、导读步进与光标反查 |
| `src/ai/` | Claude / Codex / 自定义 CLI 会话、流式足迹解析、带读生成与追问提示词 |
| `src/host/` | 侧栏与独立页签控制器、克制高亮、光标跟踪、流式答疑沉淀、Copilot 引擎与 Chat 集成 |
| `webview/src/` | Vue 3 导师面板（`WalkthroughView`、`ComposerPanel`、`QaDrawer`、ELK 复合脉络图与安全 Markdown 引用渲染） |
| `tests/` | 单元测试与 Extension Host 集成测试 |
