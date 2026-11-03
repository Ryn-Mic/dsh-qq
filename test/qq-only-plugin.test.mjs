import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createImHostPlugin, name } from '../plugin-src/host/index.mjs';
import { IMSettingsTab } from '../plugin-src/client/index.js';
import { botSettingsTabsForChannel, DELIVERY_CHANNEL_DEFINITIONS } from '../plugin-src/client/delivery-settings.js';

function internals(overrides = {}) {
  return {
    createDeliveryService: () => ({}),
    installHostLanguage: () => undefined,
    installHostLanguageRpc() {}, installInboundTtlRpc() {},
    installDeliverySyncRpc() {}, installSidebarSettingsRpc() {},
    installInjectedContext() {}, installDeliveryRpc() {},
    installDeliveryHttp() {}, installSessionSyncCoordinator() {},
    ...overrides,
  };
}

test('fork host activates only QQ and forwards shared delivery and management authority', async () => {
  const calls = [];
  const delivery = {};
  const plugin = createImHostPlugin(internals({
    createDeliveryService: () => delivery,
    applyQq: async (_ctx, config) => calls.push(config),
    applyFeishu: async () => assert.fail('removed channel must not start'),
    applyTelegram: async () => assert.fail('removed channel must not start'),
  }));
  await plugin.apply({}, { dshHome: '/tmp/qq-fixture', rpcAuthority: 'trusted-host',
    qq: { configPath: '/tmp/qq-fixture/config.json' }, feishu: {}, telegram: {} });
  assert.equal(name, 'dsh-qq-host');
  assert.deepEqual(calls, [{ dshHome: '/tmp/qq-fixture', rpcAuthority: 'trusted-host',
    configPath: '/tmp/qq-fixture/config.json', deliveryService: delivery }]);
});

test('fork preserves dshIm contract without activating channels or reading credentials', async () => {
  let api;
  await createImHostPlugin().apply({
    provide(key, value) { if (key === 'dshIm') api = value; }, inject() {},
  });
  assert.equal(api.contractVersion, 1);
  assert.equal(api.receiptVersion, 1);
  for (const method of ['consumeInbound', 'historyChecked', 'replyChecked', 'describeConversation',
    'describeConversationSync', 'describeBot', 'sendChecked', 'send', 'listTargets', 'createTarget', 'listBots']) {
    assert.equal(typeof api[method], 'function', method);
  }
});

test('settings render QQ by default, reject removed-channel selection, and retain shared bot tabs', () => {
  for (const preferredSectionId of [undefined, 'qq', 'feishu', 'telegram']) {
    const html = renderToStaticMarkup(React.createElement(IMSettingsTab, { preferredSectionId }));
    assert.match(html, /DSH-QQ/);
    assert.match(html, /id="dim-panel-qq"/);
    assert.equal((html.match(/role="tab"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /id="dim-tab-(?:feishu|telegram|weixin)"/);
    assert.doesNotMatch(html, /检查更新|安装更新/);
  }
  assert.deepEqual(botSettingsTabsForChannel('qq').map((tab) => tab.id), ['general', 'delivery', 'ds-bot', 'access']);
  assert.deepEqual(Object.keys(DELIVERY_CHANNEL_DEFINITIONS), ['qq']);
});

test('source channel trees and bundle entrypoints contain no other channel runtime', async () => {
  for (const directory of ['src/channels', 'plugin-src/client/channels', 'plugin-src/host/channels']) {
    const entries = await readdir(new URL(`../${directory}/`, import.meta.url), { withFileTypes: true });
    assert.deepEqual(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(), ['qq', 'shared']);
  }
  for (const file of ['plugin-src/client/index.js', 'plugin-src/host/index.mjs']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ['"]\.\/channels\/(?!qq\/)/);
    assert.doesNotMatch(source, /update-rpc|update-panel/);
  }
});
