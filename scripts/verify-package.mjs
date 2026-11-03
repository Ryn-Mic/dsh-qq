import assert from 'node:assert/strict';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const packageName = '@ryn-mic/dsh-qq';
const read = (path) => readFile(resolve(root, path), 'utf8');
const [manifest, lock, host, client, patch, hostEntry, clientEntry] = await Promise.all([
  read('package.json').then(JSON.parse), read('package-lock.json').then(JSON.parse),
  read('lib/index.js'), read('lib/client.js'), read('cordis.patch.yml'),
  read('plugin-src/host/index.mjs'), read('plugin-src/client/index.js'),
]);
assert.equal(manifest.name, packageName);
assert.equal(manifest.version, '0.1.0');
assert.equal(manifest.private, true, 'personal fork must not be published to npm');
assert.equal(manifest.license, 'MIT');
assert.equal(lock.name, packageName);
assert.equal(lock.packages[''].name, packageName);
for (const path of ['LICENSE', 'README.md', 'README.en.md', 'THIRD_PARTY_NOTICES.md',
  'UPSTREAM.md', 'bin/dsh-qq.mjs', 'src/channels/qq/qq-runtime.mjs',
  'plugin-src/host/channels/qq/index.mjs', 'plugin-src/client/channels/qq/index.js']) {
  await access(resolve(root, path));
}
for (const directory of ['src/channels', 'plugin-src/host/channels', 'plugin-src/client/channels']) {
  const entries = await readdir(resolve(root, directory), { withFileTypes: true });
  assert.deepEqual(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(),
    ['qq', 'shared'], `${directory} must contain only QQ and shared code`);
}
const allowedRuntime = {
  '@tencent-connect/qqbot-connector': '1.2.0',
  '@tencent-connect/qqbot-nodejs': '1.0.4',
  qrcode: '1.5.4',
};
assert.deepEqual(manifest.dependencies, allowedRuntime);
assert.deepEqual(Object.keys(manifest.optionalDependencies), ['sharp']);
for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
  for (const dependency of Object.keys(manifest[section] ?? {})) {
    assert(!/^@deepseek-ai\/dsh-/.test(dependency), 'DSH runtime packages must come from the host');
  }
}
assert(!Object.keys(lock.packages).some((path) => /(?:^|\/)node_modules\/@deepseek-ai\/dsh-/.test(path)));
assert(client.includes('id: "@ryn-mic/dsh-qq"'), 'client must register the fork loader id');
assert(patch.includes('id: ryn-mic-dsh-qq') && patch.includes("name: '@ryn-mic/dsh-qq'"));
assert(host.includes('dsh-qq-host') && hostEntry.includes("name = 'dsh-qq-host'"));
assert(clientEntry.includes("id: 'ryn-mic-dsh-qq'"));
assert(clientEntry.includes("Object.freeze([{ id: 'qq', label: 'QQ' }])"));
assert(!/from ['"]\.\/channels\/(?!qq\/)/.test(hostEntry + clientEntry));
for (const removed of ['update.install', 'update.check', 'registry.npmjs.org', 'desktopPnpm', '@xmanrui/dsh-im']) {
  assert(!host.includes(removed) && !client.includes(removed), `bundles retain upstream updater or identity: ${removed}`);
}
for (const marker of ['bot.context-enhancement.set', 'bot.model.set', 'bot.access-policy.set',
  'target.create', 'target.session-sync.set']) {
  assert(host.includes(marker) && client.includes(marker), `shared management capability missing: ${marker}`);
}
assert.equal(manifest.bin['dsh-qq'], 'bin/dsh-qq.mjs');
if (process.platform !== 'win32') assert((await stat(resolve(root, 'bin/dsh-qq.mjs'))).mode & 0o111);
assert(!/private-bot-token|must-be-rolled-back|DEEPSEEK_API_KEY=/.test(client + host));
const { createImHostPlugin } = await import(pathToFileURL(resolve(root, 'lib/index.js')).href);
let deliveryApi;
await createImHostPlugin().apply({
  provide(name, value) { if (name === 'dshIm') deliveryApi = value; },
  // Do not activate QQ, read saved credentials, or connect to anything.
  inject() {},
});
assert.equal(deliveryApi.contractVersion, 1);
for (const method of ['consumeInbound', 'historyChecked', 'replyChecked', 'describeConversation',
  'describeConversationSync', 'describeBot', 'sendChecked', 'send', 'listTargets', 'createTarget', 'listBots']) {
  assert.equal(typeof deliveryApi[method], 'function', `dshIm.${method} is required`);
}
console.log('Verified @ryn-mic/dsh-qq package, QQ-only entrypoints, disabled updater, and dshIm contract.');
