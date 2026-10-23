# SillyTavern 新前端

独立前端，沿用 SillyTavern 后端。此仓库只包含前端源码，不包含聊天、角色卡、API 密钥、用户配置或完整后端。

## 安装

1. 准备可运行的 SillyTavern 后端。
2. 将此仓库的 `public/app` 文件夹复制到 SillyTavern 的 `public/app`。
3. 启动后端，浏览器打开 `/app/`。手机使用电脑的局域网地址。

## 更新检查

每次打开或刷新 `/app/` 时，在后台读取本仓库 main 分支的 `version.json`。有不同版本时显示“发现新前端版本”，点击查看仓库更新。网络失败或超时不影响使用。检查只发送普通匿名读取请求，不包含聊天和连接配置。

此功能负责检查和提示；安装更新需要覆盖后端中的 `public/app` 文件。只刷新网页无法更新服务器文件。

## 发布代码更新

修改 `public/app` 后运行 `python scripts/refresh-version.py`，将源码、`version.json`、`public/app/version.js` 一起提交到 main。运行文件内容摘要用于判断版本是否一致。

## 验证

使用 Node.js 运行 `node --test public/app/tests/*.test.mjs`。两个后端集成测试在没有 SillyTavern 后端源码时明确跳过；其余测试可独立运行。测试目录不会在页面加载时执行。

## 许可

遵循上游 SillyTavern 的 AGPL-3.0 许可。第三方 DOMPurify 和 Showdown 的许可证位于 `public/app/vendor`。
