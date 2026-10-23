#!/usr/bin/env bash
set -eu
repo="$(cd "$(dirname "$0")/.." && pwd)"
tavern="${1:-$HOME/SillyTavern}"
[ -f "$tavern/server.js" ] || { echo "未找到酒馆：$tavern"; exit 1; }
mkdir -p "$tavern/public/app" "$tavern/plugins/st-new-updater"
cp -R "$repo/public/app/." "$tavern/public/app/"
cp "$repo/server/st-new-updater/index.mjs" "$tavern/plugins/st-new-updater/index.mjs"
node --input-type=module - "$tavern/config.yaml" <<'JS'
import fs from 'node:fs';
const file = process.argv[2];
let value = fs.readFileSync(file, 'utf8');
if (!fs.existsSync(file + '.before-st-new-updater')) fs.copyFileSync(file, file + '.before-st-new-updater');
if (/^enableServerPlugins:/m.test(value)) value = value.replace(/^enableServerPlugins:.*$/m, 'enableServerPlugins: true');
else value += '\nenableServerPlugins: true\n';
fs.writeFileSync(file, value);
JS
echo "前端与更新模块已安装，请重启酒馆。以后从输入框加号菜单点击检查更新。"
