# 代码侦探 🕵️ Code Detective

把 AI 对某个功能的分析，变成能点击源码的代码地图。

**外部 AI 负责分析；代码侦探负责展示、跳转和高亮。** 第一版读取工作区内的地图 JSON，不需要在插件中配置模型或 API Key。

当前版本：**0.1.0，初步开发版**。界面沿用已选定的深色地图风格：蓝色节点、紫色条件节点、琥珀色当前关系与源码高亮。

## 快速试用

1. 在 VS Code 桌面版（1.95 或以上）执行 `Extensions: Install from VSIX...`，选择 `code-detective-0.1.0.vsix`。
2. 解压源码包，以 **`examples/bag-demo` 为工作区根目录** 打开。地图会从这个根目录下的 `.code-detective/maps/` 发现。
3. 打开命令面板，执行 **代码侦探: 打开地图**。
4. 点击“加载界面”节点查看实现，点击“未命中时调用”连线查看调用处。多个来源会显示列表，选择具体位置后再跳转。
5. 点击“开始导读”体验三个阅读步骤。停止导读或清除高亮会移除本插件的装饰。

安装包也在源码项目的 `artifacts/` 中。用源码启动时，先执行下方构建命令，再按 F5 选择“运行代码侦探”，会在 Extension Development Host 中打开背包示例。

## 在自己的项目中使用

在项目根目录创建 `.code-detective/maps/`。执行 **代码侦探: 复制 AI 地图生成提示词**，把复制的规范和你想了解的话题交给现有编码 AI。

例如：

> 帮我梳理从点击背包按钮，到加载资源、创建界面，再到刷新物品列表的流程，生成代码侦探地图。

AI 写入有效 JSON 后，插件会更新地图列表。AI 保存到一半或生成了不合法的新版本时，插件保留上次有效地图并显示错误；点击“查看 JSON”可以修正文件。

地图协议详见 [AI 生成规范](docs/ai-authoring.md) 和 [JSON Schema](schemas/code-map-v1.schema.json)。完整设计在 [开发文档](docs/development.md)。

## 已实现

- 发现、选择和监听 `.code-detective/maps/*.json`，支持多个工作区根目录。
- 严格 JSON、重复键、字段、范围、ID 与引用校验。
- Vue Flow 交互地图与 ELK 自动布局，支持缩放、平移、拖动、分支、循环、自环与平行边。
- 节点定位实现，连线定位调用或关系所在位置；多处来源由用户选择。
- 真实 VS Code 编辑器分栏导航，保留地图焦点，并可显式“进入源码”。
- 相关范围和当前选择两层高亮，同文件多个可见编辑器分别应用。
- 前进、后退与停止导读；地图选择、节点位置、视口和阅读状态恢复。
- 基于当前编辑器文本（含未保存修改）的来源检查。
- 精确文本锚点匹配与唯一位置恢复；缺失、越界和不确定位置有明确状态。
- 深色与浅色主题、键盘可用的对象目录和来源列表。

插件不推导调用关系；图中的结论和解释来自地图作者。文本锚点匹配只恢复位置，不代表分析结论仍然正确。

## 开发

需要 Node.js **20.19+ 或 22.12+** 和 npm。推荐使用当前 Node.js LTS。

```sh
npm ci
npm run check
npm run package
```

| 命令 | 用途 |
| --- | --- |
| `npm run typecheck` | 检查扩展、Webview、测试与示例 TypeScript |
| `npm test` | 核心、Host 输入边界及 Controller 模拟测试 |
| `npm run build` | 输出 Host 与 Webview 到 `dist/` |
| `npm run package` | 生成 `artifacts/code-detective-0.1.0.vsix` |
| `npm run dev` | 启动浏览器中的 Webview 交互预览 |

浏览器预览使用 `webview/preview.ts`，通过示例数据模拟 Host 消息，右侧源码是演示区域。**实际插件只渲染地图 Webview，右侧使用 VS Code 原生源码编辑器。** 预览适配器不会进入 VSIX 的生产脚本。

开发服务器的 `scripts/preview-env.cjs` 只在环境无法枚举网卡信息时省略可选的 LAN 地址展示，不改变监听权限或插件代码。

## 工程结构

| 路径 | 职责 |
| --- | --- |
| `src/extension.ts` | 扩展激活与退出 |
| `src/core/` | 地图校验、来源位置匹配、选择状态 |
| `src/host/` | 工作区文件、消息、源码导航、高亮和持久化 |
| `shared/` | 地图类型与消息协议 |
| `webview/src/` | Vue 地图、详情与导读界面 |
| `schemas/` | v1 JSON Schema |
| `examples/bag-demo/` | 可以编译和实际运行的背包示例 |
| `tests/` | 可重复的自动验证 |
| `docs/` | 开发规范、AI 生成规范和验收记录 |

## 本轮验证的边界

类型检查、核心测试、Host 边界测试、Controller 模拟和构建/打包结果见 [验收记录](docs/verification.md)。Controller 测试使用真实地图与临时源码文件，VS Code API 使用测试替身，不能代替真实 Extension Host 验收。

本轮的云浏览器无法连接本地预览服务，尚未完成第 2 张设计稿与实际渲染的截图比对。当前环境也没有可运行的 VS Code 图形会话，真实编辑器中的分栏、焦点和装饰仍需安装后验证。相关状态记录在 `design-qa.md`，未标记为通过。

首轮面向桌面 VS Code；远程工作区、虚拟工作区、Cursor 和 PinK 的专门适配尚未验收。

## 发布前

`publisher` 当前为本地开发标识 `code-detective-dev`。发布 Marketplace 前应配置实际 publisher、发布授权与项目许可。本项目当前标记为 `UNLICENSED`，第三方依赖许可保存在 `THIRD-PARTY-NOTICES.txt`。
