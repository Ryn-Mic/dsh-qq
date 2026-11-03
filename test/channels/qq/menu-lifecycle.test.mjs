import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QqHarnessBridge } from '../../../src/channels/qq/qq-bridge.mjs';
import { QqStateStore } from '../../../src/channels/qq/state-store.mjs';
import { createQqInteractionHandler } from '../../../src/channels/qq/interaction-actions.mjs';
import { QqMenuStore, QQ_MENU_TTL_MS } from '../../../src/channels/qq/qq-menu.mjs';

const route = 'c2c:synthetic-owner';
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
async function fixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'qq-lifecycle-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const other = join(dir, 'other'); await mkdir(other);
  const state = await new QqStateStore(join(dir, 'state.json')).load();
  await state.setSession(route, 'synthetic-session');
  let workspace = dir, sessionWorkspace = dir, sequence = 0, model = 'm1';
  let models = ['m1', 'm2'];
  const sessions = [{ sessionId: 'synthetic-session', title: 'Synthetic' }];
  const sent = [], acks = [], calls = [];
  const catalog = () => ({ current: { provider: 'p', model }, routable: true, failures: [],
    groups: [{ id: 'p', name: 'provider', models: models.map(id => ({ id, name: id })) }] });
  const harness = {
    currentWorkspace: () => workspace,
    currentConversationWorkspace: () => sessionWorkspace,
    ensureRunning: async () => { calls.push('ensureRunning'); return true; },
    listWorkspaceSessions: async () => { calls.push('sessions'); return { sessions }; },
    listWorkspaces: async () => [workspace, other],
    listModels: async () => { calls.push('models'); return catalog(); },
    agentPresetSettings: async () => ({ agentPreset: null, agentPresetCatalog: { defaultId: 'standard', items: [{ id: 'standard', label: 'Standard' }] } }),
    sessionExists: async () => true,
    ask: async (_sessionId, text) => { calls.push(`ask:${text}`); return 'Synthetic answer'; },
    bindWorkspaceSession: async (key, sessionId) => {
      calls.push(`bindSession:${sessionId}`);
      await state.setSession(key, sessionId);
      return { workspace: sessionWorkspace, sessionId, title: sessionId, archived: false };
    },
    workspaceSession: () => ({
      models: async () => { calls.push('models'); return catalog(); },
      sessionExists: async () => true, isRunning: async () => false, hasActiveTurn: async () => false,
      ask: async text => { calls.push(`ask:${text}`); return 'Synthetic answer'; },
      stopActiveTurn: async () => { calls.push('stop'); return true; },
      selectModel: async selection => { calls.push('selectModel'); model = selection.model; return { selected: selection }; },
    }),
  };
  const bot = {
    appId: 'synthetic-app',
    sendText: async (target, text) => { sent.push({ target, text }); return { id: `out-${sent.length}` }; },
    send: async args => { sent.push({ ...args, text: args.markdown?.content }); return { id: `out-${sent.length}` }; },
    acknowledgeInteraction: async (id, code) => { acks.push({ id, code }); },
  };
  const bridge = new QqHarnessBridge({ bot, harness, state, ownerUserOpenid: 'synthetic-owner', streamingEnabled: true,
    logger: { warn() {}, error() {} } });
  const handler = createQqInteractionHandler({ bot, bridge, appId: 'synthetic-app', ownerUserOpenid: 'synthetic-owner', logger: { warn() {} } });
  const send = text => bridge.accept({ kind: 'c2c', senderId: 'synthetic-owner', messageId: `in-${++sequence}`, content: text,
    rawEventType: 'C2C_MESSAGE_CREATE', replyTarget: { scope: 'c2c', targetId: 'synthetic-owner', msgId: `anchor-${sequence}` } });
  const latest = () => sent.findLast(x => x.keyboard);
  const click = (menu, number) => {
    const button = menu.keyboard.content.rows.flatMap(row => row.buttons)[number - 1];
    const event = { id: `interaction-${++sequence}`, application_id: 'synthetic-app', type: 11, version: 1,
      chat_type: 2, scene: 'c2c', user_openid: 'synthetic-owner',
      data: { type: 11, resolved: { button_data: button.action.data, button_id: button.id } } };
    return handler({ bot, event, receivedAt: Date.now(), transportEventId: `frame:${event.id}:opaque` }, event);
  };
  return { state, sent, acks, calls, sessions, harness, bot, send, latest, click,
    moveWorkspace: () => { workspace = other; },
    moveSessionWorkspace: () => { sessionWorkspace = other; },
    removeFirstModel: () => { models = ['m2']; },
  };
}

const context = { workspace: '/synthetic', sessionWorkspace: '/synthetic', sessionId: 'synthetic-session' };
const navigationView = { entries: [{ action: { kind: 'section', name: 'main' } }] };
function stage(store, route, actor, view = navigationView) {
  const entry = store.stage(route, actor, context);
  assert.equal(store.publish(route, actor, entry, view), true);
  return entry;
}

test('QQ staged menus remain clickable by token while numeric selection stays on the confirmed card', () => {
  const store = new QqMenuStore();
  const first = stage(store, route, 'synthetic-owner');
  assert.equal(store.activate(route, 'synthetic-owner', first), true);
  const candidate = stage(store, route, 'synthetic-owner');
  assert.equal(store.tokenFor(route, 'synthetic-owner'), first.token);
  assert.ok(store.inspect(route, 'synthetic-owner', 1, candidate.token, context).action);
  assert.equal(store.activate(route, 'synthetic-owner', candidate), true);
  assert.equal(store.tokenFor(route, 'synthetic-owner'), candidate.token);
  assert.ok(store.take(route, 'synthetic-owner', 1, first.token, context).action);
  assert.ok(store.take(route, 'synthetic-owner', 1, first.token, context).action);
  assert.equal(store.activate(route, 'synthetic-owner', first), false, 'a slower earlier send cannot steal the active pointer');
  store.clear(route, 'synthetic-owner');
  assert.equal(store.has(route, 'synthetic-owner'), false);
  assert.ok(store.inspect(route, 'synthetic-owner', 1, first.token, context).action, 'ordinary input only exits numeric selection');
  assert.equal(store.activate(route, 'synthetic-owner', candidate), false, 'an in-flight response cannot reopen numeric selection after ordinary input');
});

test('QQ menu mutation replay protection belongs to each button while navigation stays reusable', () => {
  const store = new QqMenuStore();
  const entry = stage(store, route, 'synthetic-owner', { entries: [
    { action: { kind: 'command', text: '/stop' } },
    { action: { kind: 'command', text: '/compact' } },
    ...navigationView.entries,
  ] });
  assert.ok(store.take(route, 'synthetic-owner', 1, entry.token, context).action);
  assert.equal(store.take(route, 'synthetic-owner', 1, entry.token, context).reason, 'already-used');
  assert.ok(store.take(route, 'synthetic-owner', 2, entry.token, context).action);
  assert.ok(store.take(route, 'synthetic-owner', 3, entry.token, context).action);
  assert.ok(store.take(route, 'synthetic-owner', 3, entry.token, context).action);
});

test('QQ historical menus report stable rejection reasons and keep route, actor, context and TTL protection', () => {
  let time = 0;
  const store = new QqMenuStore({ now: () => time });
  const entry = stage(store, route, 'synthetic-owner');
  assert.equal(store.inspect(route, 'synthetic-other', 1, entry.token, context).reason, 'actor-mismatch');
  assert.equal(store.inspect('c2c:synthetic-other', 'synthetic-owner', 1, entry.token, context).reason, 'route-mismatch');
  assert.equal(store.inspect(route, 'synthetic-owner', 1, 'f'.repeat(24), context).reason, 'unknown-token');
  assert.equal(store.inspect(route, 'synthetic-owner', 8, entry.token, context).reason, 'invalid-choice');
  assert.equal(store.inspect(route, 'synthetic-owner', 1, entry.token, { ...context, sessionId: 'changed' }).reason, 'context-changed');
  time = QQ_MENU_TTL_MS;
  assert.equal(store.inspect(route, 'synthetic-owner', 1, entry.token, context).reason, 'expired');
  for (let i = 0; i < 257; i++) stage(store, route, 'synthetic-owner');
  assert.equal(store.inspect(route, 'synthetic-owner', 1, entry.token, context).reason, 'unknown-token');
});

test('QQ menu history evicts old tokens at its capacity and expires numeric selection', () => {
  let time = 0;
  const store = new QqMenuStore({ now: () => time });
  const first = stage(store, route, 'synthetic-owner');
  store.activate(route, 'synthetic-owner', first);
  let last;
  for (let i = 0; i < 256; i++) last = stage(store, route, 'synthetic-owner');
  assert.equal(store.inspect(route, 'synthetic-owner', 1, first.token, context).reason, 'unknown-token');
  assert.ok(store.inspect(route, 'synthetic-owner', 1, last.token, context).action);
  assert.equal(store.has(route, 'synthetic-owner'), false);
  store.activate(route, 'synthetic-owner', last);
  time = QQ_MENU_TTL_MS;
  assert.equal(store.inspect(route, 'synthetic-owner', 1, last.token, context).reason, 'expired');
  assert.equal(store.has(route, 'synthetic-owner'), false);
});

test('QQ root cards support repeated section choices, help, back navigation and independent mutations', async t => {
  const f = await fixture(t); await f.send('/m'); const main = f.latest();
  await f.click(main, 1); const sessions = f.latest();
  await f.click(main, 4); assert.match(f.latest().text, /^🧠 模型/u);
  await f.click(main, 13); assert.match(f.latest().text, /^📖 帮助/u);
  await f.click(sessions, 2); assert.match(f.latest().text, /^🤖 助手中心/u);
  await f.click(main, 1); assert.match(f.latest().text, /^📋 会话列表/u);
  await f.click(main, 7); assert.equal(f.calls.filter(x => x === 'stop').length, 1);
  await f.click(main, 13); assert.match(f.latest().text, /^📖 帮助/u);
  assert.ok(f.acks.every(x => x.code === 0));
});

test('QQ a section load failure preserves root button navigation and its numeric selection', async t => {
  const f = await fixture(t); await f.send('/m'); const main = f.latest();
  const original = f.harness.listWorkspaceSessions;
  f.harness.listWorkspaceSessions = async () => { throw new Error('synthetic-backend-down'); };
  await f.click(main, 1); assert.equal(f.latest(), main);
  f.harness.listWorkspaceSessions = original;
  await f.send('4'); assert.match(f.latest().text, /^🧠 模型/u);
  await f.click(main, 13); assert.match(f.latest().text, /^📖 帮助/u);
});

test('QQ Host health failure leaves the old root usable for help and digit navigation', async t => {
  const f = await fixture(t); await f.send('/m'); const main = f.latest();
  f.harness.ensureRunning = async () => { throw new Error('synthetic-host-offline'); };
  await f.click(main, 12); assert.equal(f.latest(), main);
  await f.send('13'); assert.match(f.latest().text, /^📖 帮助/u);
  await f.click(main, 13); assert.match(f.latest().text, /^📖 帮助/u);
  assert.ok(f.acks.every(x => x.code === 0));
});

test('QQ an uncertain menu send preserves prior numeric selection and keeps the possible delivered token usable', async t => {
  const f = await fixture(t); await f.send('/m'); const main = f.latest();
  const original = f.bot.send; let candidate;
  f.bot.send = async args => { candidate = args; throw new Error('synthetic-unknown-delivery'); };
  await f.click(main, 4); assert.ok(candidate?.keyboard);
  f.bot.send = original;
  await f.send('4'); assert.match(f.latest().text, /^🧠 模型/u);
  await f.click(candidate, 3); assert.match(f.latest().text, /^🤖 助手中心/u);
});

test('QQ early candidate callbacks work and a late HTTP response cannot replace a newer confirmed menu', async t => {
  const f = await fixture(t); await f.send('/m'); const main = f.latest();
  const original = f.bot.send, gate = deferred(), published = deferred(); let candidate;
  f.bot.send = async args => {
    if (!candidate) { candidate = args; published.resolve(); await gate.promise; }
    return original(args);
  };
  const pending = f.click(main, 4); await published.promise;
  await f.send('13'); assert.match(f.latest().text, /^📖 帮助/u, 'digits still address the prior confirmed root');
  await f.click(candidate, 3); assert.match(f.latest().text, /^🤖 助手中心/u);
  gate.resolve(); await pending;
  await f.send('4'); assert.match(f.latest().text, /^🧠 模型/u);
  assert.ok(f.acks.every(x => x.code === 0));
});

for (const initialRoot of [false, true]) {
  test(`QQ slow view loading cannot reopen digit selection after ordinary input (${initialRoot ? 'existing' : 'first'} menu)`, async t => {
    const f = await fixture(t);
    if (initialRoot) await f.send('/m');
    const gate = deferred(), started = deferred();
    const original = f.harness.listWorkspaceSessions;
    f.harness.listWorkspaceSessions = async (...args) => { started.resolve(); await gate.promise; return original(...args); };
    const pending = f.send('/m sessions'); await started.promise;
    await f.send('ordinary-before-menu');
    gate.resolve(); await pending;
    await f.send('1');
    assert.ok(f.calls.includes('ask:ordinary-before-menu'));
    assert.ok(f.calls.includes('ask:1'), 'the late menu must not intercept a subsequent digit');
    assert.ok(!f.calls.some(x => x.startsWith('bindSession:')));
  });
}

test('QQ slow older navigation cannot steal digits from a newer confirmed menu', async t => {
  const f = await fixture(t); await f.send('/m'); const main = f.latest();
  const gate = deferred(), started = deferred();
  const original = f.harness.listWorkspaceSessions;
  f.harness.listWorkspaceSessions = async (...args) => { started.resolve(); await gate.promise; return original(...args); };
  const pending = f.click(main, 1); await started.promise;
  await f.click(main, 13); assert.match(f.latest().text, /^📖 帮助/u);
  gate.resolve(); await pending;
  await f.send('1');
  assert.match(f.latest().text, /^🤖 助手中心/u, 'digit 1 belongs to the confirmed help card, not the late session list');
  assert.ok(!f.calls.some(x => x.startsWith('bindSession:')));
});

test('QQ concurrent navigation remains usable while each mutation button executes once', async t => {
  const f = await fixture(t); await f.send('/m'); const main = f.latest();
  await Promise.all([f.click(main, 1), f.click(main, 4)]);
  assert.ok(f.sent.some(x => /^📋 会话列表/u.test(x.text)));
  assert.ok(f.sent.some(x => /^🧠 模型/u.test(x.text)));
  const models = f.sent.findLast(x => x.keyboard && /🧠/.test(x.text));
  await Promise.all([f.click(main, 7), f.click(main, 7)]);
  assert.equal(f.calls.filter(x => x === 'stop').length, 1);
  await f.click(models, 2); await f.click(models, 1);
  assert.equal(f.calls.filter(x => x === 'selectModel').length, 2, 'another model button on the same card remains valid');
  await f.click(models, 2);
  assert.equal(f.calls.filter(x => x === 'selectModel').length, 2);
});

test('QQ an unavailable model choice does not consume the other model buttons', async t => {
  const f = await fixture(t); await f.send('/m models'); const menu = f.latest();
  f.removeFirstModel();
  await f.click(menu, 1); assert.match(f.sent.at(-1).text, /没有找到模型/);
  assert.equal(f.calls.filter(x => x === 'selectModel').length, 0);
  await f.click(menu, 2); assert.equal(f.calls.filter(x => x === 'selectModel').length, 1);
});

test('QQ historical pages preserve displayed session IDs after catalog reordering', async t => {
  const f = await fixture(t);
  f.sessions.push(...Array.from({ length: 8 }, (_, i) => ({ sessionId: `listed-${i}`, title: `Listed ${i}` })));
  await f.send('/m sessions'); const first = f.latest();
  f.sessions.reverse();
  await f.click(first, 7); const second = f.latest();
  await f.click(second, 4); assert.match(f.latest().text, /第 1 \/ 2 页/);
  await f.click(first, 7); assert.match(f.latest().text, /第 2 \/ 2 页/);
  await f.click(second, 1);
  assert.equal(f.state.sessionFor(route), 'listed-5');
  assert.ok(f.calls.includes('bindSession:listed-5'));
});

for (const changed of ['session', 'workspace', 'sessionWorkspace']) {
  test(`QQ ${changed} changes refresh stale navigation without applying old page snapshots or mutations`, async t => {
    const f = await fixture(t);
    f.sessions.push(...Array.from({ length: 8 }, (_, i) => ({ sessionId: `listed-${i}`, title: `Listed ${i}` })));
    await f.send('/m sessions'); const first = f.latest();
    await f.click(first, 7); const second = f.latest();
    if (changed === 'session') await f.state.setSession(route, 'changed-session');
    if (changed === 'workspace') f.moveWorkspace();
    if (changed === 'sessionWorkspace') f.moveSessionWorkspace();
    const expectedSession = f.state.sessionFor(route);
    await f.click(first, 7);
    assert.match(f.latest().text, /^🤖 助手中心/u, 'stale pagination only opens a fresh root');
    await f.click(second, 1);
    assert.match(f.latest().text, /^🤖 助手中心/u);
    assert.equal(f.state.sessionFor(route), expectedSession);
    assert.ok(!f.calls.some(x => x.startsWith('bindSession:')));
    assert.ok(f.acks.every(x => x.code === 0));
  });
}
