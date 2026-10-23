# SillyTavern 新前端

独立前端，沿用 SillyTavern 后端。此仓库只包含前端源码，不包含聊天、角色卡、API 密钥、用户配置或完整后端。

## 安装

1. 准备可运行的 SillyTavern 后端。
2. 将此仓库的 `public/app` 文件夹复制到 SillyTavern 的 `public/app`。
3. 启动后端，浏览器打开 `/app/`。手机使用电脑的局域网地址。

## 手动更新

页面加载时不会自动检查或安装。输入框加号菜单中选择“检查更新”；没有新版会提示已是最新，有新版弹出确认，取消关闭弹窗，确定后下载并安装。安装完成后手动刷新页面生效。

首次需要在 Termux 安装更新模块（将此模块复制到酒馆 plugins 并启用 enableServerPlugins，配置会先备份）。停止酒馆后执行：

```bash
git -C ~/st_new pull --ff-only
bash ~/st_new/scripts/install-termux.sh ~/SillyTavern
cd ~/SillyTavern
bash start.sh
```

安装一次后，页面内的确认更新会由后端更新模块完成。模块只从此仓库 main 分支下载清单中列出的 public/app 文件，先校验全部文件再替换前端；失败时保留原目录。不会更新聊天、角色卡、密钥、配置或后端模块本身。未安装模块时会提示安装，不会冒充更新成功。

## 发布代码更新

修改 `public/app` 后运行 `python scripts/refresh-version.py`，将源码、`version.json`、`public/app/version.js` 一起提交到 main。运行文件内容摘要用于判断版本是否一致。

## 验证

使用 Node.js 运行 `node --test public/app/tests/*.test.mjs`。两个后端集成测试在没有 SillyTavern 后端源码时明确跳过；其余测试可独立运行。测试目录不会在页面加载时执行。

## 许可

遵循上游 SillyTavern 的 AGPL-3.0 许可。第三方 DOMPurify 和 Showdown 的许可证位于 `public/app/vendor`。
