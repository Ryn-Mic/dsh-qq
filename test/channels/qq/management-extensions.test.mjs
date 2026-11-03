import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { QqController } from '../../../src/channels/qq/qq-controller.mjs';
import { QqConfigStore, deriveQqBotIdentity } from '../../../src/channels/qq/config-store.mjs';
import { defaultQqNativeConfiguration } from '../../../src/channels/qq/native-presets.mjs';
import { validateNativeMenu, validatePanelCreate } from '../../../src/channels/qq/native-menu.mjs';
import { createQqRpcHandler, QQ_ENDPOINTS } from '../../../plugin-src/host/channels/qq/rpc.mjs';
import { unwrapRpcResult } from '../../../plugin-src/client/channels/qq/api.js';
import { QqEnhancementsEditor } from '../../../plugin-src/client/channels/qq/enhancements.js';

function rpcController(extra = {}) {
  return {
    status: () => ({ bots: [] }), startProvisioning: async () => ({}),
    registrationStatus: () => null, cancelProvisioning: async () => null,
    bindCredentials: async () => ({ bots: [] }), reconnectBot: async () => ({ bots: [] }),
    deleteBot: async () => ({ bots: [] }), ...extra,
  };
}

test('suggested menus/panel comply with QQ schemas and return fresh objects', () => {
  const defaults = defaultQqNativeConfiguration();
  validateNativeMenu({ menu: defaults.menu });
  validatePanelCreate(defaults.panel);
  assert.equal(defaults.menu.items.length, 3);
  assert.equal(defaults.panel.panel.items.length, 12);
  defaults.menu.items.length = 0;
  assert.equal(defaultQqNativeConfiguration().menu.items.length, 3);
});

test('feature settings persist through a fresh config load without saving credentials', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'qq-features-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'config.json');
  const store = await new QqConfigStore(path).load();
  const config = { ...deriveQqBotIdentity('test-app'), appId: 'test-app', ownerUserOpenid: 'owner' };
  await store.save(config);
  const seen = [];
  const nativeCalls = [];
  const richCalls = [];
  const runtime = { status: { ready: true, qqConnectionState: 'connected' },
    start: async () => {}, stop: async () => {}, setStreamingEnabled: value => seen.push(value),
    nativeManagement: async (...args) => { nativeCalls.push(args); return { version: 1 }; },
    sendRich: async (...args) => { richCalls.push(args); return { id: 'ignored-provider-id' }; } };
  const controller = new QqController({ configStore: store,
    qrAuth: { start() {} }, credentials: { resolve: async () => ({ value: 'not-persisted' }),
      set: async () => {}, unset: async () => {} },
    createRuntime: async () => runtime });
  t.after(() => controller.close());
  await controller.initialize();
  const status = await controller.configureFeatures(config.botId, { streamingEnabled: true });
  assert.equal(status.bots[0].features.streamingEnabled, true);
  assert.equal((await new QqConfigStore(path).load()).get(config.botId).streamingEnabled, true);
  assert.deepEqual(seen, [true]);
  await assert.rejects(controller.configureFeatures(config.botId, { streamingEnabled: 'true' }), TypeError);
  await controller.configureFeatures(config.botId, { streamingEnabled: false });
  assert.notEqual((await new QqConfigStore(path).load()).get(config.botId).streamingEnabled, true);
  assert.doesNotMatch(JSON.stringify(controller.status()), /not-persisted|secretRef|ownerUserOpenid/);
  assert.deepEqual(await controller.nativeManagement(config.botId, 'getMenu', {}), { version: 1 });
  assert.equal(nativeCalls[0][0], 'getMenu');
  assert.deepEqual(await controller.sendRichMessage(config.botId,
    { scope: 'c2c', targetId: 'owner' }, { type: 'text', text: 'test' }), { sent: true });
  assert.deepEqual(richCalls[0][0], { kind: 'user', route: { userOpenId: 'owner' } });
});

test('management writes require explicit confirmation and fixed action fields', async () => {
  const calls = [];
  const handler = createQqRpcHandler(rpcController({ nativeManagement: async (...args) => { calls.push(args); return {}; } }));
  for (const payload of [
    { botId: 'qq_bot', action: 'putMenu', args: { menu: {} } },
    { botId: 'qq_bot', action: 'destroyEverything', confirm: true },
    { botId: 'qq_bot', action: 'getMenu', args: { appSecret: 'forbidden' } },
  ]) assert.equal((await handler(QQ_ENDPOINTS.nativeManage, payload)).error.code, 'bad-request');
  assert.equal(calls.length, 0);
  assert.equal((await handler(QQ_ENDPOINTS.nativeManage, {
    botId: 'qq_bot', action: 'putMenu', args: { menu: { items: [] } }, confirm: true,
  })).ok, true);
  assert.equal(calls[0][1], 'putMenu');
});

test('malformed and circular RPC records fail before reaching the controller', async () => {
  const cyclic = {}; cyclic.self = cyclic;
  const handler = createQqRpcHandler(rpcController());
  const result = await handler(QQ_ENDPOINTS.nativeManage, { botId: 'qq_bot', action: 'getMenu', args: cyclic });
  assert.equal(result.error.code, 'bad-request');
});

test('native management public output strips secret keys recursively', async () => {
  const handler = createQqRpcHandler(rpcController({ nativeManagement: async () => ({
    menu: { items: [] }, access_token: 'never-return', nested: { clientSecret: 'never-return' },
  }) }));
  const result = await handler(QQ_ENDPOINTS.nativeManage, { botId: 'qq_bot', action: 'getMenu' });
  assert.equal(result.ok, true);
  assert.doesNotMatch(JSON.stringify(result), /never-return/);
});

test('uncertain writes preserve reconciliation state and safe restore data even after cancellation', async () => {
  const abort = new AbortController();
  const error = Object.assign(new Error('provider internals must stay private'), {
    code: 'qq-management-outcome-unknown', menuBackup: { menu: { items: [] }, token: 'never-return' },
    menuRestore: { menu: { items: [] } },
  });
  const handler = createQqRpcHandler(rpcController({ nativeManagement: async () => {
    abort.abort(); throw error;
  } }));
  const result = await handler(QQ_ENDPOINTS.nativeManage, {
    botId: 'qq_bot', action: 'createPanel', args: { panel: {} }, confirm: true,
  }, abort.signal);
  assert.equal(result.error.code, error.code);
  assert.equal(result.error.reconciliationRequired, true);
  assert.deepEqual(result.error.menuRestore, { menu: { items: [] } });
  assert.doesNotMatch(JSON.stringify(result), /never-return|provider internals|请稍后重试/);
  assert.throws(() => unwrapRpcResult(result), cause => cause.reconciliationRequired === true
    && cause.menuRestore.menu.items.length === 0);
});

test('menu version conflicts and invalid schemas are not downgraded to generic retry advice', async () => {
  for (const [failure, code] of [
    [Object.assign(new Error('private detail'), { code: 'qq-menu-version-conflict' }), 'qq-menu-version-conflict'],
    [new TypeError('private detail'), 'bad-request'],
  ]) {
    const handler = createQqRpcHandler(rpcController({ nativeManagement: async () => { throw failure; } }));
    const result = await handler(QQ_ENDPOINTS.nativeManage, { botId: 'qq_bot', action: 'getMenu' });
    assert.equal(result.error.code, code);
    assert.doesNotMatch(result.error.message, /private detail|请稍后重试/);
  }
});

test('rich-send RPC requires an explicit native route and confirmation', async () => {
  const calls = [];
  const handler = createQqRpcHandler(rpcController({ sendRichMessage: async (...args) => {
    calls.push(args); return { sent: true };
  } }));
  const request = { botId: 'qq_bot', target: { scope: 'c2c', targetId: 'owner' },
    message: { type: 'text', text: 'test' } };
  assert.equal((await handler(QQ_ENDPOINTS.sendRich, request)).ok, false);
  assert.equal((await handler(QQ_ENDPOINTS.sendRich, { ...request, confirm: true })).value.sent, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].targetId, 'owner');
});

function uiFixture(manage = async () => ({})) {
  const calls = [];
  const props = { account: { botId: 'qq_bot', connected: true, features: { streamingEnabled: false } },
    onManage: async (...args) => { calls.push(args); return manage(...args); }, onFeaturesSave: async () => {} };
  return { calls, props };
}
const action = (view, name) => view.root.findByProps({ 'data-qq-action': name });

test('opening enhancements performs no cloud writes; applying menu reads and saves a backup first', async () => {
  const f = uiFixture(async name => name === 'defaults' ? defaultQqNativeConfiguration()
    : name === 'getMenu' ? { menu: { items: [] }, version: 2 } : { version: 3 });
  let view;
  await act(async () => { view = create(React.createElement(QqEnhancementsEditor, f.props)); });
  assert.equal(f.calls.length, 0);
  assert.equal(action(view, 'streaming').props.checked, false);
  await act(async () => { await action(view, 'defaults').props.onClick(); });
  assert.equal(action(view, 'save').props.disabled, true);
  await act(async () => { action(view, 'confirm').props.onChange({ target: { checked: true } }); });
  await act(async () => { await action(view, 'save').props.onClick(); });
  assert.deepEqual(f.calls.map(call => call[0]), ['defaults', 'getMenu', 'putMenu']);
  assert.equal(f.calls[2][2], true);
  const backup = view.root.findByType('a');
  assert.deepEqual(JSON.parse(decodeURIComponent(backup.props.href.split(',')[1])), { menu: { items: [] } });
  assert.equal(action(view, 'confirm').props.checked, false);
  await act(async () => view.unmount());
});

test('failed menu backup prevents replacement and displays a failure', async () => {
  const f = uiFixture(async name => {
    if (name === 'defaults') return defaultQqNativeConfiguration();
    throw new Error('backup unavailable');
  });
  let view;
  await act(async () => { view = create(React.createElement(QqEnhancementsEditor, f.props)); });
  await act(async () => { await action(view, 'defaults').props.onClick(); });
  await act(async () => { action(view, 'confirm').props.onChange({ target: { checked: true } }); });
  await act(async () => { await action(view, 'save').props.onClick(); });
  assert.equal(f.calls.some(call => call[0] === 'putMenu'), false);
  assert.equal(view.root.findByProps({ role: 'alert' }).children[0], 'backup unavailable');
  await act(async () => view.unmount());
});

test('double clicks cannot duplicate a panel creation', async () => {
  let release;
  const f = uiFixture(async name => name === 'defaults' ? defaultQqNativeConfiguration()
    : new Promise(resolve => { release = resolve; }));
  let view;
  await act(async () => { view = create(React.createElement(QqEnhancementsEditor, f.props)); });
  await act(async () => { view.root.findByType('select').props.onChange({ target: { value: 'panel' } }); });
  await act(async () => { await action(view, 'defaults').props.onClick(); });
  await act(async () => { action(view, 'confirm').props.onChange({ target: { checked: true } }); });
  const save = action(view, 'save').props.onClick;
  let first;
  await act(async () => { first = save(); await save(); });
  assert.equal(f.calls.filter(call => call[0] === 'createPanel').length, 1);
  await act(async () => { release({ panel_id: 'p_created' }); await first; });
  assert.equal(view.root.findAllByType('input').find(input => input.props.type !== 'checkbox').props.value, 'p_created');
  await act(async () => view.unmount());
});
