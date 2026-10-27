# 架构地图与上下文入口

核对日期：2026-10-27。依据：本地 `main` 的 `4784e3d`，梳理开始时工作区干净；这不是已部署或已发布版本声明。模块职责或数据流改变时更新本文，精确函数和字段以源码为准。本次验证及能力摘要见 [项目现状](project-status.md)。

## 项目边界

源码仓库为 `st_new`。`public/app` 是部署到 SillyTavern `/app/` 的原生 JavaScript ES modules，无框架、打包器或独立路由；`server/st-new-updater` 是本项目的可选 Node 插件。官方后端及其数据不在本仓库中。

主要验收副本和数据操作授权见 [开发流程](development.md)。源码与宿主内的部署文件可能不同，浏览器结果必须关联实际部署版本。

## 模块地图

以下源码相对 `public/app/`；通过函数名搜索，不依赖易失效的行号。

| 职责 | 源码与关键入口 | 依赖及阅读入口 |
|---|---|---|
| 页面与状态编排 | `main.js`：`start`、`showPanel`、`loadPanelContent`、`openCharacter`、`loadChat`、`saveChat`、`generate` | 集中协调业务，不是纯 UI；跨模块变更先查调用方 |
| 入口与通用 UI | `index.html`、`theme-init.js`、三个 CSS、`select.js`、`icons.js`、`prompt-drag.js` | [UI 唯一规范](ui-design-guidelines.md) |
| 原生 API 与保存 | `api.js`：`TavernAPI`、`readEvents`；`connection.js`、`preset-selection.js` | [集成契约](sillytavern-integration.md) |
| 首页和角色目录 | `home-data.js`、`character-catalog.js`、`library.js` | 最近聊天、完整角色目录、分类是不同数据来源 |
| 生成引擎 | `engine.js`：`expand`、`activateWorlds`、`buildPrompt`、`fitPrompt`、`generationBody` | 正则、变量、世界书、资料库；[生成流程](generation-flow.md) |
| 世界书与预设 | `character-world.js`、`world-*.js`、`preset-editor.js`、`preset-selection.js` | 原生数据格式、角色关联、未展示字段保留 |
| 消息与阅读 | `virtual-chat.js`、`message-markdown.js`、`message-edit.js`、`code-blocks.js`、`reading.js` | 显示正则、HTML iframe、回复分支；[HTML 兼容](html-card-compatibility.md) |
| 剧情资料库 | `database.js`、`database-reference.js`、`database-defaults.js`、`database-ui.js`、`database-preview.js`、`database-overview.js` | 双总结、模板与当前聊天历史；[模型与快照契约](domains/lore-database.md) |
| 正则和角色脚本 | `regex.js`、`scripts.js`、`script-runtime.js`、`script-bridge.js`、`script-helper.js`、`script-modules.js`、`helper-state.js` | [兼容范围](scripts-compatibility.md)、[远程助手](remote-script-runtime.md) |
| 变量与角色适配 | `variable-manager.js`、`variable-macros.js`、`mvu-compat.js`、`script-schema.js`、`role-*.js` | [变量管理器](variable-manager.md)；远程原模块与本地适配路径须区分 |
| 加载与缓存 | `generation-preload.js`、`history-regex-cache.js`、`preset-tokens.js`、`load-timings.js`、`diagnostic-export.js` | [性能契约](domains/performance.md) |
| 聊天上传准备 | `chat-save-body.js`、`api.js` | JSON 序列化、条件 gzip 与回退；[集成契约](sillytavern-integration.md) |
| 更新和发布 | `update.js`、仓库 `server/st-new-updater/index.mjs`、`scripts/` | [开发与发布](development.md) |

## 状态所有权与生命周期

- `main.js` 的 `state` 持有当前角色、聊天文件、头、消息、设置、连接状态、生成控制器及保存状态；`profileStore` 持有独立连接集合。
- 面板通过同一个 `dialog` 调度，没有页面路由框架。`panelRevision` 和加载 token 防止旧异步结果覆盖新面板；`_dispose` 取消预览等工作，`_onReady` 在内容显示后启动后续处理。
- `panelDirty` 与聊天 `state.dirty` 不是同一状态；`busy`、`loading`、变量保存和脚本处理分别限制操作。改动守卫必须检查所有相关路径。
- 角色和聊天先在局部变量中读取，成功后一起提交身份和内容。偏好保存失败不得让角色与旧聊天混用。
- 普通聊天保存复制当前数据后进入 `state.saves` 队列；设置通过 `TavernAPI.saveQueue` 排队。变量编辑与助手批次还有各自的旧值/修订检查和回读，不是统一事务层。
- 当前角色脚本有独立 iframe 生命周期；切换身份使旧环境失效。消息 HTML iframe 是另一套上下文与桥接，不等同于角色脚本宿主。

## 需要一起检查的影响面

| 修改入口 | 至少检查 |
|---|---|
| 消息编辑、删除、重新生成、切换候选 | `swipes/swipe_info`、消息变量、资料快照、显示正则、缓存失效、聊天保存 |
| 世界书或预设 | 关联来源、未知字段、宏状态、提示词顺序、精确预算、预览与发送结果 |
| 资料库或变量保存 | 会话身份、旧值/修订、后端回读、脚本快照、预加载失效 |
| UI 加载或异步请求 | 面板销毁、旧结果保护、草稿、取消与重试 |
| 更新插件 | 原生接口回退、共享代码权限、安装/重启、文件清单与恢复 |

## 文档如何使用

- 开发规则由根 [AGENTS.md](../AGENTS.md) 承担；本文件用于整体导航，不复制领域字段。
- 文档区分代码事实、带环境和日期的验收、批准的设计约束、待核实风险。工作区实现不代表已提交、部署或发布。
- `audit-2026-10-24/REPORT.md`、`changes-2026-10-24.md`、性能专项和 UI 后半部分是历史证据，按任务读取，不作为默认上下文。
- 不维护全仓库函数列表、测试数量或逐次聊天摘要。需要新决策或复杂交接时再创建对应记录，规则见开发流程。

## 维护关注点（2026-10-27，静态核对）

- `main.js` 集中 UI、会话、生成和持久化，是跨模块冲突点；按实际任务逐步提取职责，不为文档体系进行重构。
- `regex.js.applyRegex` 按捕获组数字直接读取替换回调 args，未排除尾部 offset/原文参数；越界替换存在确定的逻辑问题，待独立修复和回归，本次未运行复现。
- 自动填表与无变化解析见资料库契约，更新授权见集成契约；不要复制成多份待办。旧审计的角色切换 F1 已有当前源码修复及 `tests/chat-session.test.mjs`，不能仍列为未修复。
- 资料落盘失败、跨标签页竞争、浏览器账号隔离和远程 beta 可变性是需按场景验证的风险，不等同于已发生的数据损坏。修复/验收后更新对应条目。
