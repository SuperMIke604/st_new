# 开发、验收与交接

工作约定确认：2026-10-26。工程入口、环境授权、发布或协作方式改变时更新。长期开发规则见根 [AGENTS.md](../AGENTS.md)，模块入口见 [架构地图](architecture.md)。

## 源码与验收环境

| 路径 | 用途和授权 |
|---|---|
| `D:\酒馆\st_new` | 日常源码与长期文档；独立 Git 仓库 |
| `D:\酒馆\SillyTavern - 有数据` | 用户备份出的主要验收副本，用户已允许直接进行任务相关数据操作，无需为这一环境重复确认 |
| `D:\酒馆\SillyTavern` | 另一宿主参考副本，不默认作为验收写入目标 |
| 用户自用环境 | 位于其他地方；本约定不授予访问、部署或修改权限 |

允许备份副本数据验收不等于允许修改官方后端、无关批量清理或调用付费模型。优先独立测试聊天/记录，明确创建、修改、保留或清理了什么；若验证必须改现有记录，保留必要恢复信息，不将私有夹具提交到仓库。

源码、部署前端和运行中的插件是三个状态。2026-10-26 静态核对发现两个宿主的 `public/app` 均非源码完整副本；不能把源码测试通过当作浏览器运行新版。验收前检查实际端口、前端文件和插件加载状态。用户已授权每次代码修改并验证完成后直接部署本任务改动到“有数据”验收副本，无需重复确认；保留部署前文件备份，不夹带其他未完成任务的改动。浏览器刷新与插件重启要求由实际修改决定；此授权不包含线上发布、提交或推送。

## 验证入口（从源码仓库根执行）

```powershell
git status --short --branch
git diff --stat
git diff --check
node --check public/app/main.js
node --test public/app/tests/database.test.mjs public/app/tests/database-reference.test.mjs
```

上述 JS/测试只是示例，替换为本次影响文件。跨模块行为需要全量回归时：

```powershell
node --test public/app/tests/*.test.mjs server/st-new-updater/updater.test.mjs
```

- 没有项目级构建、lint、TypeScript 检查入口；不运行猜测的 `npm install/build/test`。
- 更新插件测试会在临时目录创建/替换文件，并非只读。运行前了解脚本副作用，不在真实用户目录运行历史故障探针。
- 引擎中的两个宿主集成项尝试按相对路径读取本仓库不包含的 `src/util.js`、`src/prompt-converters.js`，缺失时明确 skip。旁边存在宿主不意味着测试会自动使用它；按实际输出报告跳过原因。
- Node 测试包含纯函数、接口模拟、源码切片/VM 等，不能据数量推导真实浏览器全部通过。UI、iframe、软键盘需相应浏览器或实机验证。
- 持久化验证包含保存后回读、刷新恢复、未知字段和其他分支保留；失败恢复与跨会话身份检查另行覆盖。
- 验证记录需注明日期、源码基线和环境；最近一次整体梳理见 [项目现状](project-status.md)，历史文档通过数不代表当前执行。
- 若 Windows 沙箱临时目录中的更新测试因目录重命名报 `EPERM`，可把当前测试进程的 `TEMP/TMP` 指向仓库内已忽略的 `.audit-tmp` 后复跑；先确保目录存在，只影响本进程，不修改系统环境。仍失败时保留实际错误，不能归为通过或直接跳过。

### Android APK 与 MuMu 模拟器

本地 APK 可以直接用已安装的 MuMu 模拟器验收。Windows 的 MuMu 5 可通过 `MuMuManager.exe` 启动实例并查询 ADB 地址。当前验收机的可执行文件与 `adb.exe` 同在 `D:\Program Files\Netease\MuMu\nx_main`，验收实例为 Android 15。使用实际返回的实例索引和 ADB 地址。

```powershell
$mumu = 'D:\Program Files\Netease\MuMu\nx_main'
$manager = Join-Path $mumu 'MuMuManager.exe'
$adb = Join-Path $mumu 'adb.exe'
$index = 0
& $manager info --vmindex all
& $manager control --vmindex $index launch
# 等 Android 启动完成，再取本次地址。
$device = & $manager info --vmindex $index | ConvertFrom-Json
$serial = "$($device.adb_host_ip):$($device.adb_port)"
& $adb connect $serial
& $adb -s $serial shell getprop ro.build.version.sdk
```

从待验收源码构建 APK，构建脚本可用 `-JavaHome` 和 `-SdkRoot` 指定 JDK 与 Android SDK。需要和现有安装并行时，在 `.audit-tmp` 暂存副本里给 Manifest 包名加测试后缀，保留 Activity 和 Service 的完整 Java 类名，再用 `adb -s $serial install -r <测试APK路径>` 安装。APK 连接 `127.0.0.1` 上的酒馆。使用 Windows 上的模拟后端时，可用 `adb -s $serial reverse tcp:<模拟器端口> tcp:<Windows端口>` 映射本机端口，并在 APK 的连接失败页设置对应端口。测试结束后移除本次 `reverse` 映射。使用本地模拟模型和测试聊天时，可以据服务器记录判断请求实际到达的时间和次数。

验收发送延迟时，配置一个足够操作的延迟，点发送后立即上滑回 Android 桌面，也可用 `adb -s $serial shell input keyevent KEYCODE_HOME`。保持 APK 在后台，确认倒计时结束前模型请求数为 0、结束后为 1。重新进入后检查回复已显示且没有重复请求，再复测倒计时内点停止及从最近任务移除 APK，两种操作均应让尚未交给后端的发送停止。模拟器结果记录 Android 版本、包类型、后端和观测到的时点。手机省电策略和厂商后台行为另外用真机验证。

2026-11-26 在 MuMu Android 15（API 35）使用独立调试包、实际前端与后台生成插件、本机模拟模型验收。配置 8 秒延迟，点发送后立即切回桌面，后端在点击后约 8.1 秒收到唯一一条模型请求。拉长页面计时器后单独复测原生计时，仍在约 8.1 秒送达。返回 APK 后回复正常显示，后端接手后前台服务结束。倒计时内点击停止或划掉最近任务，模型请求数均未增加。

## 分支、worktree 与并行

开始先识别已有修改，禁止自动 reset、清理、stash 或把用户成果提交进当前任务。2026-10-26 建立文档时 main 已有远程助手相关未提交文件；后续以实时 Git 状态为准。

一个交付目标一个分支；并行写任务优先独立 worktree，并明确文件所有权、基线和集成者。未提交修改不会自动进入新 worktree；先决定当前任务需要的实现在哪个工作区。worktree 只隔离代码，不隔离同一宿主的设置、聊天、端口和部署目录。

独立纯模块可并行。共同修改 `main.js`、全局 CSS、保存/生成链路、共享文档或版本清单时宜串行，由一个任务集成；同一聊天和设置不由多个线程同时验收。最终合并后重新检查交叉影响。

## 对话和完成标准

按具体目标建对话，可使用 `UI｜...`、`资料库｜...`、`助手｜...`、`性能｜...` 标题；同一目标的实现/修复/验收继续当前对话。跨模块任务保留一个协调入口，不拆成互相不知道契约的任务。

新对话先读规则、Git 状态、相关领域入口；只有架构不清楚时再读架构地图，不默认读取历史审计。完成需要目标行为、适当失败路径、验证证据、正确 diff，以及实际部署/未部署说明。最终报告区分代码完成、测试通过、环境跳过、模拟验收、真实后端和未验证事项。

## 长期知识与恢复

- 行为、契约、边界或流程改变才更新唯一负责的文档。具体 CSS 值、函数列表、当前测试数量每次从代码/运行获取。
- 规范与历史记录并存时明确标记；有日期/基线的旧审计不直接作为当前缺陷清单。实现与文档冲突时核对代码，并显式指出偏离设计，不能偷偷把要求改成现状。
- 不建立日常 progress 流水账。只有经用户确认的多阶段路线图才考虑一份简短进度文件，记录当前里程碑、阻塞和下一步，完成项压缩归档。
- 重要且非显然的决策才新建 `docs/decisions/YYYY-MM-DD-topic.md`：背景、选择、原因、约束、替代方案、后果及源码；不把推测包装成已批准决定。
- 复杂任务未完成、将换对话或上下文恢复成本高时才新建 `docs/handoffs/YYYY-MM-DD-topic.md`，无需空模板目录。

交接最小内容：目标/验收/禁止范围；分支、基线与工作目录；原有和本任务修改；已完成事实及决定；实际验证与未覆盖项；部署/数据变更和恢复办法；下一步源码入口及命令。压缩前完成一个阶段时更新交接即可，不逐条复制工具输出。接手先核对实时 diff，完成后将交接标为完成，不让多个文件竞争当前状态。

## 发布（仅在发布准备任务中执行）

`scripts/refresh-version.py` 会遍历 `public/app` 中除 tests 和生成版 version.js 外的文件，并纳入自有插件生成摘要；写入 `version.json` 和 `public/app/version.js`。修改 `public/app/README.md`、`DATABASE-PARITY.md` 也会影响下次发布清单。纯文档任务不重算版本、不部署；后续发布者在目标代码和文档确定后统一生成并核验。

`main` 是正式更新器的下载源。推送涉及更新分发文件的改动时，须先运行 `python scripts/refresh-version.py`，再运行 `node --test server/st-new-updater/version-manifest.test.mjs`，将生成的两个版本文件与源码一起提交。只推送源码而保留旧清单会导致文件校验失败。

本轮包含 APK 改动时，用户要求推送到 GitHub 即包含发布 APK。推送前按根 README 更新 APK 版本号，使用原签名密钥构建并校验安装包。推送后以该提交创建 `apk-v<versionCode>` 的 GitHub Release，上传 `st-new.apk`，核对附件可下载并告知发布版本。

在线更新下载固定仓库 main 上的清单和文件，校验后暂存替换，有异常回滚；插件更新可能需要重启。Termux 安装脚本直接复制并启用服务端插件，具有配置和部署副作用，不能作为一般验证命令。官方后端不由此更新。流程细节见根 README 与 `server/st-new-updater/index.mjs`。

当前不需要记忆插件、定时总结或自动改写文档。重复验收流程稳定后再考虑 Skill/CI；发布清单与共享文档由集成任务统一维护。
