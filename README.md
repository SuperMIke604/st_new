# SillyTavern 新前端

独立前端，沿用 SillyTavern 官方后端。本仓库包含 `public/app` 前端、自有 `server/st-new-updater` 插件、测试及安装/发布脚本，不包含聊天、角色卡、API 密钥、用户配置或完整官方后端。

## 开发上下文

当前能力、梳理基线、验证范围与待办入口见 [项目现状](docs/project-status.md)。该文档区分源码实现、自动测试与实际部署，避免将历史记录当作当前验收结论。

新任务先遵循 [AGENTS.md](AGENTS.md)，按任务读取领域文档；整体入口为 [架构地图](docs/architecture.md)。接口与数据位置见 [集成契约](docs/sillytavern-integration.md)，验收环境、Git、验证、发布和交接见 [开发流程](docs/development.md)。

UI 复用 [现有规范](docs/ui-design-guidelines.md)；剧情资料库见 [模型与快照](docs/domains/lore-database.md)；助手见 [兼容范围](docs/scripts-compatibility.md)；加载见 [性能约束](docs/domains/performance.md)。文档区分当前代码、历史验收和待核实事项，不依赖长对话恢复背景。

## 安装

1. 准备可运行的 SillyTavern 后端。
2. 将此仓库的 `public/app` 文件夹复制到 SillyTavern 的 `public/app`。
3. 启动后端，浏览器打开 `/app/`。手机使用电脑的局域网地址。

## Android APK

APK 在手机上打开同一设备中由 Termux 提供的 `http://127.0.0.1:8000/app/`。首次使用时先按安装说明把前端部署到 SillyTavern，再在 Termux 启动后端。已有部署时直接启动后端即可。使用其他端口时，可在连接失败页选择“修改端口”。使用账号的后端需要在 APK 内单独登录一次。

启用 SillyTavern 的 HTTP Basic Auth 时，APK 会先显示原生登录页，请输入 `config.yaml` 中配置的账号和密码。输入有误时可在原页重试，也可返回连接设置修改端口。如果同时启用了酒馆用户账户，通过 HTTP 认证后，仍可能需要在酒馆的用户登录页面继续登录。

Windows 构建需要 JDK 17、Android SDK Platform 34 和 Build-Tools 34.0.0。设置 `JAVA_HOME` 和 `ANDROID_HOME` 后，从项目根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\android\build-apk.ps1
```

安装包为 `android/build/st-new.apk`，适用于 Android 7.0 及以上。保留同目录的 `debug.keystore` 可为后续 APK 使用同一个签名。网页更新仍由 Termux 中的前端和更新插件处理。导出文件请用手机浏览器打开同一个地址。

### 从 GitHub 更新 APK

使用 Android 版时，请在同一次升级中更新 Termux 里的网页前端和更新插件，并将手机 APK 更新到对应版本。

1. 在输入框旁的「＋」菜单中选择「检查更新」，安装网页前端和更新插件。按页面提示重启 SillyTavern 并刷新。
2. 在同一个菜单中选择「检查 APK 更新」。检测到新版本后，从 GitHub 下载安装包，再通过 Android 安装器覆盖安装。

发布 APK 时，先增加 `android/AndroidManifest.xml` 的 `versionCode` 并更新 `versionName`，再用同一份签名密钥构建。到 [GitHub Releases](https://github.com/SuperMIke604/st_new/releases) 发布正式版，标签为 `apk-v<versionCode>`，例如 1.2 的 `versionCode` 为 3，标签为 `apk-v3`。将 `st-new.apk` 上传为该 Release 的附件。APK 会在最近 30 个 Release 中查找符合约定且版本号最高的 APK。签名密钥保留在本机。

## 手动更新

页面加载时不会自动检查或安装。输入框加号菜单中选择“检查更新”；没有新版会提示已是最新，有新版弹出确认，取消关闭弹窗，确定后下载并安装。安装完成后手动刷新页面生效。

首次需要在 Termux 安装更新模块（将此模块复制到酒馆 plugins 并启用 enableServerPlugins，配置会先备份）。停止酒馆后执行：

```bash
git -C ~/st_new pull --ff-only
bash ~/st_new/scripts/install-termux.sh ~/SillyTavern
cd ~/SillyTavern
bash start.sh
```

安装一次后，页面内的确认更新会由后端更新模块完成。模块只从此仓库 main 分支下载清单中列出的 public/app 文件，以及固定的 server/st-new-updater/index.mjs 插件文件；全部校验成功后一起替换，替换失败时恢复旧版，恢复异常时保留备份。不会更新聊天、角色卡、密钥、配置、其他插件或酒馆后端本身。插件文件变化后页面提示重启酒馆并刷新，插件未变化时只需刷新页面。不会自动终止酒馆进程。

旧更新模块尚不支持替换自身，需要最后再运行一次上面的安装脚本并重启。完成这次升级后，后续前端与更新插件都可以通过“检查更新”一起安装。前端会识别旧模块并明确提示这次升级要求；“已是最新”也会检查后端文件是否需要升级或尚待重启。

下载遇到临时 HTTP 503 等错误时，更新模块会重试，并在需要时通过同一仓库的 GitHub API 下载对应文件。若旧模块反复报 503，可通过上面的 Git 安装步骤升级一次，重启后继续使用页面内更新。

## 发布代码更新

仅在发布准备时运行 `python scripts/refresh-version.py`，统一生成 `version.json` 和 `public/app/version.js`，核验后由用户决定提交/发布。`public/app` 下的 Markdown 也属于清单输入；普通开发和纯文档任务不自动重算版本、提交或推送。内容摘要用于判断版本是否一致。

## 验证

按影响选择 Node 测试；全量命令为 `node --test public/app/tests/*.test.mjs server/st-new-updater/updater.test.mjs`。两个后端集成项在缺少相对路径下的官方源码时明确跳过。更新测试会写临时目录，浏览器验收和持久化回读另行执行；详见开发流程。测试目录不会在页面加载时执行。

## 许可

遵循上游 SillyTavern 的 AGPL-3.0 许可。第三方 DOMPurify 和 Showdown 的许可证位于 `public/app/vendor`。

## 预设选择与首页启动

预设内容仍由酒馆服务端的预设目录管理。当前启用的预设名称保存在每个用户的 `files/independent-frontend-preset.json`，不再使用浏览器本地记录恢复。首次升级从现有服务端配置迁移一次；如旧记录已被重置，请重新选择一次。读取失败不会写入默认预设，已删除的预设会要求重新选择，不会静默启用第一个。

新版更新模块增加轻量 `/recent` 和 `/bootstrap` 接口：首页只扫描角色及聊天文件的文件名与修改时间，不读取聊天正文；启动仅加载设置和 OpenAI 预设。完整角色集合在打开角色管理时读取。API 连接加载失败不影响首页和角色资料，发送前会要求修复连接。

升级此版本请再运行一次 `scripts/install-termux.sh` 并重启后端，以安装新增接口。仅更新前端文件时会兼容回退到旧接口，但不能获得全部启动性能改进。首页保留原图清晰度，图片按可见位置懒加载，失败时显示占位提示。

## 加载状态与耗时日志

首页等待后端连接、设置与预设、最近角色和 API 连接初始化全部结束后再收起加载动画。初始化失败会显示重试入口；连接初始化失败时仍可查看资料，发送前需要修复连接。预设、世界书、角色卡、正则和用户设定统一在数据读取与页面渲染完成后收起动画，快速切换时不会被旧请求覆盖。

首页“加载日志”或输入框加号菜单中的“加载日志”可查看、刷新、导出和清空最近 200 条记录。同一标签页刷新后保留记录，刷新时尚未结束的任务标记为“刷新中断”。记录包括全局初始化阶段、管理页面、生成上下文、生成全程和接口响应时间；接口计时到响应头返回，页面计时包含数据解析及渲染。请求只记录去掉查询参数的接口路径，不记录请求体、响应内容或密钥。浏览器控制台也会输出 `[加载耗时]`。

可选更新模块接口返回 404、或首次使用时配置文件尚不存在，会标记为“兼容回退”，原生兼容流程继续运行。页面切换导致的取消和刷新中断也属于正常记录。真正的 HTTP 错误、超时、网络失败仍标为“失败”，详情列与导出 JSON 包含状态码或固定原因。旧版本记录没有这些字段时会明确标注缺少详情，不推测过去的失败原因。

预设管理按需解析选中的预设，编辑表单在展开条目时创建。条目 Token 数在页面显示后后台精确统计，最多同时执行两个计数任务；长聊天分片处理，数据库和世界书在当前计数批次中按需共用。重复打开时复用有界内存缓存中的精确结果，关闭页面、切换面板或重新排列条目时取消旧任务。发送前的正式上下文构建与预算校验继续独立执行。
