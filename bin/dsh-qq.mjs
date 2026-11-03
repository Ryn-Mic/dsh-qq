#!/usr/bin/env node

import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const PACKAGE_NAME = '@ryn-mic/dsh-qq';
const DEFAULT_SOURCE = 'github:Ryn-Mic/dsh-qq#feat/qq-only-enhancements';
function usage() {
  console.log(`Usage:
  dsh-qq install [--profile web] [--source <package-spec>]
  dsh-qq uninstall [--profile web]

Examples:
  npx -y github:Ryn-Mic/dsh-qq#feat/qq-only-enhancements install
  dsh-qq install --source .`);
}

function takeOption(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

function runDsh(args) {
  const result = spawnSync('dsh', args, {
    cwd: tmpdir(),
    stdio: 'inherit',
    shell: false,
  });
  if (result.error?.code === 'ENOENT') {
    throw new Error('找不到 dsh，请先安装 DeepSeek Harness 并确保 dsh 在 PATH 中。');
  }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`dsh 退出，状态码 ${result.status ?? 1}`);
}

const args = process.argv.slice(2);
const command = args.shift();

if (!command || command === '--help' || command === '-h') {
  usage();
  process.exit(0);
}

try {
  const profile = takeOption(args, '--profile', 'web');
  if (command === 'install') {
    const requested = takeOption(args, '--source', DEFAULT_SOURCE);
    const source = requested === '.' || requested === '..'
      || requested.startsWith('./') || requested.startsWith('../')
      ? resolve(process.cwd(), requested)
      : requested;
    if (args.length > 0) throw new Error(`无法识别的参数：${args.join(' ')}`);

    runDsh(['plugin', '--profile', profile, 'add', '--save-exact', source]);
    console.log('\nQQ 机器人插件已安装。请重启 dsh web、刷新浏览器，然后打开「设置 → QQ 机器人」。');
  } else if (command === 'uninstall') {
    if (args.length > 0) throw new Error(`无法识别的参数：${args.join(' ')}`);
    runDsh(['plugin', '--profile', profile, 'remove', PACKAGE_NAME]);
    console.log('\nQQ 机器人插件已卸载。请重启 dsh web。');
  } else {
    throw new Error(`无法识别的命令：${command}`);
  }
} catch (error) {
  console.error(`dsh-qq: ${error.message}`);
  process.exit(1);
}
