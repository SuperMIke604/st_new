const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

async function main() {
    const [directory, handle] = process.argv.slice(2);
    if (!directory || !handle) throw Error('用法：node enable-single-login.cjs 酒馆目录 酒馆用户名');
    const root = path.resolve(directory);
    await fs.access(path.join(root, 'server.js'));
    const hostRequire = createRequire(path.join(root, 'package.json'));
    const { parseDocument } = hostRequire('yaml');
    const configPath = path.join(root, 'config.yaml');
    const configText = await fs.readFile(configPath, 'utf8');
    const config = parseDocument(configText);
    if (config.errors.length) throw Error('config.yaml 格式有误。');

    const storage = hostRequire('node-persist');
    const storagePath = path.resolve(root, config.get('dataRoot') || './data', '_storage');
    await fs.access(storagePath);
    await storage.init({ dir: storagePath, expiredInterval: 0, ttl: false });
    const account = await storage.getItem(`user:${handle}`);
    if (!account?.enabled || !account.password || account.stNewDisplay) throw Error('请先为已有的原版酒馆账号设置主密码。');

    config.set('enableUserAccounts', true);
    config.set('enableServerPlugins', true);
    config.set('basicAuthMode', false);
    const backup = `${configPath}.before-single-login`;
    try { await fs.copyFile(configPath, backup, constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    hostRequire('write-file-atomic').sync(configPath, config.toString({ lineWidth: 0 }), 'utf8');
    console.log('已启用单次登录。重启酒馆后，从 /app/ 用酒馆账号登录。');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
