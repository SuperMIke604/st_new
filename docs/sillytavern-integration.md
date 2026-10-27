# SillyTavern 集成与持久化契约

核对日期：2026-10-26；依据为当前工作区源码。接口、存储、宿主版本或兼容边界改变时更新。以下前端路径相对 `public/app/`。

## 接入与外部依赖

前端在宿主 `/app/` 使用同源会话；`api.js` 先取 `/csrf-token`，POST 携带 `X-CSRF-Token`，JSON 或 multipart 请求均复用宿主认证。登录重定向、HTTP 错误通过 `ApiError` 暴露；SSE 用 `readEvents` 处理 UTF-8 分块及事件边界。

本机两份宿主核对基线：SillyTavern 1.19.0、提交 `06bde939f`。这不是所有版本兼容保证；升级后重新核对实际请求和返回格式，不修改官方源码来掩盖前端不兼容。

模型由官方后端转发，但提示词、宏、世界书激活、正则及上下文预算主要由 `engine.js` 实现，不等同于原生前端的全部生成语义。支持范围应从引擎校验和测试确认，不从“后端兼容”推导。

## 实际接口族与调用位置

| 接口族 | 用途 | 主要调用方 |
|---|---|---|
| `/api/settings/get`、`save` | 设置快照、整文件保存 | `api.js`、`main.js` |
| `/api/characters/*` | 列表、单卡、聊天列表、创建、导入导出、复制、删除、合并、头像 | `main.js`、`character-catalog.js`、`character-world.js`、`scripts.js` |
| `/api/chats/get/save/delete/recent` | JSONL 聊天读写及最近入口 | `main.js`、`api.js`、`home-data.js` |
| `/api/worldinfo/list/get/edit/delete` | 世界书读写 | `main.js`、`character-world.js` |
| `/api/presets/save/delete` | OpenAI 预设正文 | `main.js`；读取依赖设置响应中的预设集合 |
| `/api/avatars/get/upload/delete` | persona 头像 | `main.js` |
| `/api/secrets/read/write` | secret 元信息与密钥注册 | `main.js` |
| `/api/backends/chat-completions/status/generate` | 模型目录、聊天和填表请求 | `main.js`、`engine.js` |
| `/api/tokenizers/openai/count?model=...` | 精确预算与预览计数 | `main.js`、`preset-tokens.js` |
| `/api/files/upload`、`/user/files/independent-frontend-*.json` | 独立连接和预设选择 | `api.js`、`preset-selection.js` |
| `/api/plugins/st-new-updater/*` | `recent/bootstrap/status/install` | `api.js`、`home-data.js`、`update.js` |

传输集中在 `TavernAPI`，业务路径和响应假设仍分布在调用方。图片、vendor 和远程模块另有读取路径，不应声称所有网络请求都经过统一适配器。

聊天保存仍调用原生 `/api/chats/save`，完整 JSON 只序列化一次，非缓存请求不再额外序列化生成读取缓存键。支持 CompressionStream 时，至少 256KiB 且压缩后减少超过 10% 的请求使用 gzip；JSON 结构、未知字段和 integrity 不变，原生 body-parser 解压后仍走相同校验、写入与备份。浏览器不支持、压缩失败或收益不足时用普通 JSON；收到明确的 HTTP 415 才回退普通 JSON 并在本 API 实例内停用压缩，不以完整性错误或网络失败作为回退理由。500 重试复用同一份准备好的请求体。

## 数据位置与标识

| 数据 | 位置及必须保护的规则 |
|---|---|
| 聊天 | `chat: [header, ...messages]`；`avatar_url`、`file_name` 定位，保留头和未知元数据 |
| 完整性 | `header.chat_metadata.integrity`；这是身份保护，不是并发修改版本号，不通过 force 绕过 |
| 回复分支 | `swipe_id`、`swipes`、`swipe_info` 及消息变量；不得只改显示文字而丢失分支 |
| 前端设置 | `extension_settings.independent_frontend`；`settingsOwn/saveOwn` 同时兼容顶层 `independent_frontend` 别名 |
| 连接集合 | 用户 `files/independent-frontend-connections.json`，version/activeId/profiles；可含明文 `proxyPassword`，并使用后端 secret ID |
| 选中预设 | 用户 `files/independent-frontend-preset.json`，version/name；正文仍由后端预设目录管理 |
| 角色分类 | `characterLibrary.folders/assignments`；按头像文件名关联，不按显示名或磁盘移动分类 |
| persona | `power_user.personas/persona_descriptions` 及原生头像；保留不展示的描述元数据 |
| 世界书 | 全局 `world_info_settings.world_info.globalSelect`，角色 `extensions.world`，persona 关联和内嵌 `character_book` |
| 资料库 | 消息快照和聊天头；详见 [资料库契约](domains/lore-database.md) |
| 变量和助手 | 全局 `extension_settings.variables.global`、聊天 `chat_metadata.variables`、消息 `variables[swipe_id]`；助手设置 `extension_settings.independentHelper` |
| 浏览器本地 | 主题、用户阅读键、标签页加载日志/最近入口、角色头像 IndexedDB；不能由服务器备份推导它们也已备份 |

密钥不写入浏览器 localStorage 不等于密钥不进入浏览器内存或响应。连接文件、设置及导出须按敏感数据处理；文档、测试夹具和日志不保存真实内容。

## 保存与失败语义

- `patchSettings` 清缓存、读取最新设置、修改所拥有字段，再调用整文件 `settings/save`；队列仅约束单 API 实例，不是跨标签页锁。
- `saveOwn` 保存后回读核验目标键。其他写入需要分别检查调用方，不能默认都有相同保证。
- `main.js.saveChat` 复制数据入队；`api.saveChat` 对 HTTP 500 有有界重试。失败保留未保存状态；不自动重复模型请求。
- 变量管理器和助手写入会核验旧值、分支、修订等，保存并回读。它们不是后端原子 compare-and-swap；最终读取与写入之间仍可能被外部客户端修改。
- 角色编辑及脚本保存尽量合并目标字段并保留未知字段。多步骤操作不是事务，检查中途失败后的实际落盘状态。

## 可选自有插件与升级核验

`server/st-new-updater/index.mjs` 是本项目代码，不是官方后端修改。`recent` 扫描文件名和 mtime；`bootstrap` 读取当前用户设置和 OpenAI 预设；`status/install` 管理共享前端与插件更新。

`bootstrap` 和 `recent` 的 404 可回退原生接口；配置文件首次不存在也有特定处理。认证失败、超时或损坏响应不得静默当作默认配置覆盖。

宿主升级至少核验：认证/CSRF，设置响应和整文件保存，角色标识与合并行为，聊天完整性及分支回读，世界书/预设字段保留，secret ID、自定义地址、JSON/SSE、tokenizer，以及可选插件缺失回退。

优先使用备份验收副本。宿主源码集成测试的相对路径及实际跳过条件见 [开发流程](development.md)，不要为消除 skip 而复制或修改官方源码。

## 待处理边界（2026-10-26 静态核对）

- `/install` 没有插件内管理员检查；结合本地宿主登录保护，多用户环境仍有共享代码更新权限问题。未在文档任务中修复或重现。
- 跨页面整文件保存竞争、更新进程被终止后的恢复，仍需独立故障验收。现有异常回滚不等于进程中断可自动恢复。
- 这些条目解决后删除或改为带验收依据的记录，避免长期保留失效缺陷说明。
