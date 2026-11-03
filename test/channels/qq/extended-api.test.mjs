import assert from 'node:assert/strict';
import test from 'node:test';
import { QqExtendedApi } from '../../../src/channels/qq/qq-extended-api.mjs';
import { defaultMenu, defaultPanel } from '../../../src/channels/qq/native-menu.mjs';

function fixture(responses = []) {
  const calls = [];
  let tokenCalls = 0;
  const api = new QqExtendedApi({
    bot: { api: { getToken: async () => { tokenCalls += 1; return 'synthetic-test-token'; } } },
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      const next = responses.shift() ?? {};
      if (next instanceof Error) throw next;
      return new Response(JSON.stringify(next.body ?? next), { status: next.status ?? 200 });
    },
  });
  return { api, calls, tokenCalls: () => tokenCalls };
}

test('QQ menu read/preview use the running SDK token and never publish defaults', async () => {
  const current = { version: 7, menu: null };
  const { api, calls, tokenCalls } = fixture([current]);
  const diff = await api.previewMenu(defaultMenu());
  assert.equal(diff.changed, true);
  assert.deepEqual(diff.before, current);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://api.sgroup.qq.com/v2/menu');
  assert.equal(calls[0].headers.Authorization, 'QQBot synthetic-test-token');
  assert.equal(calls[0].redirect, 'error');
  assert.equal(tokenCalls(), 1);
});

test('QQ menu apply snapshots before, writes once, rereads, and can restore the exact menu', async () => {
  const current = { version: 7, menu: { items: [{ type: 'send_message', name: '旧', send_message: '/old' }] } };
  const desired = defaultMenu();
  const { api, calls } = fixture([current, { version: 8 }, { ...desired, version: 8 },
    { ...desired, version: 8 }, { version: 9 }, { ...current, version: 9 }]);
  const applied = await api.putMenu(desired, { expectedVersion: 7 });
  assert.deepEqual(applied.restore, { menu: current.menu });
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'PUT', 'GET']);
  assert.deepEqual(JSON.parse(calls[1].body), desired);
  const restored = await api.putMenu(applied.restore, { expectedVersion: 8 });
  assert.deepEqual(restored.after.menu, current.menu);
});

test('QQ native menu no-op avoids PUT and version conflict avoids overwriting another update', async () => {
  const current = { ...defaultMenu(), version: 2 };
  const same = fixture([current]);
  assert.equal((await same.api.putMenu(defaultMenu())).changed, false);
  assert.equal(same.calls.length, 1);
  const stale = fixture([current]);
  await assert.rejects(stale.api.putMenu(defaultMenu(), { expectedVersion: 1 }), { code: 'qq-menu-version-conflict' });
  assert.equal(stale.calls.length, 1);
});

test('QQ menu unknown write outcomes preserve recovery snapshot and are never retried', async () => {
  const current = { version: 3, menu: null };
  const { api, calls } = fixture([current, new Error('synthetic network failure')]);
  await assert.rejects(api.putMenu(defaultMenu()), (error) => {
    assert.equal(error.code, 'qq-management-outcome-unknown');
    assert.deepEqual(error.menuBackup, current);
    assert.deepEqual(error.menuRestore, { menu: { items: [] } });
    return true;
  });
  assert.equal(calls.length, 2);
});

test('QQ panel CRUD and target changes use exact documented methods/paths', async () => {
  const { api, calls } = fixture([{}, { panel_id: 'p_one' }, {}, {}, {},
    { scope: 'group', target_type: 'specific' }, {}]);
  await api.listPanels({ scope: 'c2c', limit: 10, cursor: 'cursor &/' });
  await api.createPanel(defaultPanel());
  await api.getPanel('p_one');
  await api.updatePanel('p_one', { panel: defaultPanel().panel });
  await api.deletePanel('p_one');
  await api.updatePanelTargets('p_one', { op: 'add', group_openids: ['group-one'] });
  assert.equal(calls[0].url, 'https://api.sgroup.qq.com/v2/panels?scope=c2c&limit=10&cursor=cursor+%26%2F');
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST', 'GET', 'PUT', 'DELETE', 'GET', 'PUT']);
  assert.equal(calls.at(-1).url, 'https://api.sgroup.qq.com/v2/panels/p_one/target');
  assert.deepEqual(JSON.parse(calls[1].body), defaultPanel());
  assert.deepEqual(JSON.parse(calls.at(-1).body), { op: 'add', group_openids: ['group-one'] });
});

test('QQ API rejects invalid paths/bodies before acquiring credentials or making requests', async () => {
  const { api, calls, tokenCalls } = fixture();
  assert.throws(() => api.getPanel('../secret'), /panelId/u);
  assert.throws(() => api.createPanel({ ...defaultPanel(), unknown: 'value' }), /not supported/u);
  await assert.rejects(api.putMenu({ menu: { items: [{ type: 'link', name: '坏', link: 'http://example.com' }] } }), /HTTPS/u);
  assert.equal(calls.length, 0);
  assert.equal(tokenCalls(), 0);
});

test('QQ panel targets reject all-target panels and mismatched scope without mutating', async () => {
  const global = fixture([{ scope: 'c2c', target_type: 'all' }]);
  await assert.rejects(global.api.updatePanelTargets('p_one', { op: 'add', user_openids: ['u'] }), /specific/u);
  assert.equal(global.calls.length, 1);
  const wrong = fixture([{ scope: 'group', target_type: 'specific' }]);
  await assert.rejects(wrong.api.updatePanelTargets('p_one', { op: 'del', user_openids: ['u'] }), /scope/u);
  assert.equal(wrong.calls.length, 1);
});

test('QQ REST cancellation reaches fetch, timeout is bounded, and writes are not retried', async () => {
  let calls = 0;
  let requestSignal;
  const api = new QqExtendedApi({
    bot: { api: { getToken: async () => 'synthetic-test-token' } },
    fetchImpl: async (_url, { signal }) => {
      calls += 1; requestSignal = signal;
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
    timeoutMs: 10,
  });
  await assert.rejects(api.getMenu(), { code: 'qq-operation-timeout' });
  assert.equal(requestSignal.aborted, true);
  const controller = new AbortController();
  const pending = api.getMenu({ signal: controller.signal });
  setImmediate(() => controller.abort(new Error('synthetic cancellation')));
  await assert.rejects(pending, /synthetic cancellation/u);
  assert.equal(requestSignal.aborted, true);
  assert.equal(calls, 2);
});

test('QQ provider errors expose safe status/code without relaying upstream bodies', async () => {
  const { api } = fixture([{ status: 403, body: { code: 40030020, message: 'private-provider-details' } }]);
  await assert.rejects(api.getMenu(), (error) => {
    assert.equal(error.httpStatus, 403);
    assert.equal(error.bizCode, 40030020);
    assert.equal(error.message.includes('private-provider-details'), false);
    return true;
  });
});

for (const [method, write] of [
  ['POST', (api, options) => api.createPanel(defaultPanel(), options)],
  ['PUT', (api, options) => api.updatePanel('p_one', { panel: defaultPanel().panel }, options)],
  ['DELETE', (api, options) => api.deletePanel('p_one', options)],
]) {
  test(`QQ dispatched ${method} cancellation reports unknown outcome without retrying`, async () => {
    let started;
    const received = new Promise((resolve) => { started = resolve; });
    let calls = 0;
    const api = new QqExtendedApi({
      bot: { api: { getToken: async () => 'synthetic-token' } },
      fetchImpl: async (_url, { method: actualMethod, signal }) => {
        calls += 1; assert.equal(actualMethod, method); started();
        return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      },
    });
    const controller = new AbortController();
    const pending = write(api, { signal: controller.signal });
    await received;
    controller.abort(new DOMException('User cancelled after the server received the write', 'AbortError'));
    await assert.rejects(pending, { code: 'qq-management-outcome-unknown' });
    assert.equal(calls, 1);
  });
}

test('QQ dispatched create timeout/read failure/server failure all retain unknown outcomes', async () => {
  for (const failure of ['timeout', 'read', 'server']) {
    let calls = 0;
    const api = new QqExtendedApi({
      bot: { api: { getToken: async () => 'synthetic-token' } }, timeoutMs: 10,
      fetchImpl: async () => {
        calls += 1;
        if (failure === 'timeout') return new Promise(() => {});
        if (failure === 'read') return { ok: true, status: 200, text: async () => { throw new Error('synthetic response body lost'); } };
        return new Response(JSON.stringify({ code: 50001, message: 'synthetic internal failure' }), { status: 503 });
      },
    });
    await assert.rejects(api.createPanel(defaultPanel()), { code: 'qq-management-outcome-unknown' }, failure);
    assert.equal(calls, 1);
  }
});

test('QQ cancelled menu write keeps the exact backup and does not reread or restore blindly', async () => {
  const original = { version: 21, menu: { items: [{ type: 'send_message', name: '原有', send_message: '/original' }] } };
  let started;
  const received = new Promise((resolve) => { started = resolve; });
  const methods = [];
  const api = new QqExtendedApi({
    bot: { api: { getToken: async () => 'synthetic-token' } },
    fetchImpl: async (_url, { method, signal }) => {
      methods.push(method);
      if (method === 'GET') return new Response(JSON.stringify(original));
      started();
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
  });
  const controller = new AbortController();
  const pending = api.putMenu(defaultMenu(), { signal: controller.signal });
  await received;
  controller.abort();
  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'qq-management-outcome-unknown');
    assert.deepEqual(error.menuBackup, original);
    assert.deepEqual(error.menuRestore, { menu: original.menu });
    return true;
  });
  assert.deepEqual(methods, ['GET', 'PUT']);
});

test('QQ cancellation before token resolution stays cancellation and never dispatches a write', async () => {
  let tokenStarted, releaseToken;
  const started = new Promise((resolve) => { tokenStarted = resolve; });
  const token = new Promise((resolve) => { releaseToken = resolve; });
  let fetchCalls = 0;
  const api = new QqExtendedApi({
    bot: { api: { getToken: async () => { tokenStarted(); return token; } } },
    fetchImpl: async () => { fetchCalls += 1; return new Response('{}'); },
  });
  const controller = new AbortController();
  const pending = api.createPanel(defaultPanel(), { signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  releaseToken('synthetic-token');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchCalls, 0);
});

test('QQ definite write rejection remains a rejection rather than unknown or a retry', async () => {
  const { api, calls } = fixture([{ status: 400, body: { code: 40030016 } }]);
  await assert.rejects(api.createPanel(defaultPanel()), (error) => {
    assert.equal(error.httpStatus, 400);
    assert.equal(error.bizCode, 40030016);
    assert.notEqual(error.code, 'qq-management-outcome-unknown');
    return true;
  });
  assert.equal(calls.length, 1);
});
