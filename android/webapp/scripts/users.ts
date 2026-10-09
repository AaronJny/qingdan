#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { createLocalUser, disableLocalUser, setLocalPassword, AuthError } from '../lib/auth.ts';
import { closeStorage } from '../lib/storage.ts';

const commands = ['init-admin', 'add-user', 'reset-password', 'disable-user'];
const command = process.argv[2];
const extra = process.argv.slice(3);
if (!commands.includes(command) || extra.some(arg => arg !== '--admin') || (extra.length && command !== 'add-user')) {
  console.error('用法：node --experimental-strip-types scripts/users.ts init-admin|add-user [--admin]|reset-password|disable-user');
  process.exitCode = 1;
} else if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('账号管理必须在部署服务器的交互终端运行。密码不接受命令参数、环境变量或管道输入。');
  process.exitCode = 1;
} else {
  let hidden = false;
  const output = new Writable({ write(chunk, _encoding, callback) { if (!hidden) process.stdout.write(chunk); callback(); } });
  const terminal = createInterface({ input: process.stdin, output, terminal: true });
  const abort = new AbortController();
  terminal.on('SIGINT', () => abort.abort());
  const question = async (label: string, secret = false) => {
    const result = terminal.question(label, { signal: abort.signal });
    hidden = secret;
    try { return await result; }
    finally { hidden = false; if (secret) process.stdout.write('\n'); }
  };
  try {
    const email = await question('账号邮箱：');
    if (command === 'disable-user') {
      if ((await question('确认停用该账号并退出其所有会话？输入 yes：')).trim() !== 'yes') console.log('已取消。');
      else { await disableLocalUser(email); console.log('账号已停用，所有会话已退出。'); }
    } else {
      const displayName = command === 'reset-password' ? '' : await question('显示姓名：');
      const password = await question('密码（15–128 字符，不回显）：', true);
      const confirmation = await question('再次输入密码（不回显）：', true);
      if (password !== confirmation) throw new AuthError('两次密码不一致，未保存。');
      if (command === 'reset-password') {
        await setLocalPassword(email, password);
        console.log('密码已更新，所有旧会话已退出。');
      } else {
        const user = await createLocalUser({ email, password, displayName, role: extra.includes('--admin') ? 'admin' : 'user' }, { firstAdmin: command === 'init-admin' });
        console.log(`账号已创建：${user.email}（${user.role === 'admin' ? '管理员' : '用户'}）。`);
      }
    }
  } catch (error) {
    if (abort.signal.aborted) console.error('已取消，未完成的输入不会保存。');
    else console.error(error instanceof AuthError ? error.message : '账号管理未完成，请检查本地数据库目录及配置。');
    process.exitCode = 1;
  } finally {
    hidden = false;
    terminal.close();
    closeStorage();
  }
}
