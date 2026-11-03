import assert from 'node:assert/strict';
import test from 'node:test';
import { createQqInteractionHandler, qqMenuInteraction } from '../../../src/channels/qq/interaction-actions.mjs';
import { QqMenuStore, QQ_MENU_TTL_MS } from '../../../src/channels/qq/qq-menu.mjs';
import { directAccessPolicy } from '../access-policy-fixture.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture({ group = false, policy, ack, execute, signal, acknowledgementDeadlineMs, inspect } = {}) {
  let time = 100;
  let sequence = 0;
  const order = [];
  const actor = 'owner';
  const route = group ? 'group:group-one' : 'c2c:owner';
  const context = { workspace: '/workspace', sessionWorkspace: '/workspace', sessionId: 'session-one' };
  const store = new QqMenuStore({ now: () => time });
  const entry = store.begin(route, actor, context);
  store.publish(route, actor, entry, { entries: [{ label: '新会话', action: { kind: 'command', text: '/new' } }] });
  const messages = [];
  const executed = [];
  const acknowledgements = [];
  const refreshed = [];
  const diagnostics = [];
  const bot = {
    acknowledgeInteraction: async (id, code) => {
      order.push('ack'); acknowledgements.push({ id, code });
      await ack?.(id, code);
    },
    sendText: async (target, text) => { messages.push({ target, text }); },
  };
  const bridge = {
    validateMenuInteraction: (choice) => inspect ? inspect(choice) : store.inspect(choice.route, choice.actor, choice.number, choice.token, context),
    accept: async (message) => {
      order.push('accept'); messages.push(message);
      if (message.content === '/m') { refreshed.push(message); return; }
      const picked = /\/m pick (\S+) (\d+)/u.exec(message.content);
      const choice = store.take(route, message.senderId, Number(picked[2]), picked[1], context);
      if (choice.error) return bot.sendText(message.replyTarget, choice.error);
      executed.push(choice.action.text);
      await execute?.(message);
    },
  };
  const handler = createQqInteractionHandler({ bot, bridge, appId: 'app', ownerUserOpenid: actor,
    accessPolicy: policy, signal, acknowledgementDeadlineMs, now: () => time,
    logger: { info: (...args) => diagnostics.push(args), warn: (...args) => diagnostics.push(args) } });
  const event = (changes = {}) => ({
    id: `interaction-${++sequence}`, application_id: 'app', type: 11,
    scene: group ? 'group' : 'c2c', chat_type: group ? 1 : 2, version: 1,
    ...(group ? { group_openid: 'group-one', group_member_openid: actor } : { user_openid: actor }),
    data: { type: 11, resolved: { button_data: `/m pick ${entry.token} 1`, button_id: `${entry.token}_1` } },
    ...changes,
  });
  const handle = (eventValue = event(), contextChanges = {}) => handler({ bot, event: eventValue, state: {}, receivedAt: time, ...contextChanges }, eventValue);
  return { bot, bridge, handler, handle, event, context, entry, store, messages, acknowledgements, executed, refreshed, diagnostics, order,
    advance: (ms) => { time += ms; } };
}

for (const group of [false, true]) {
  test(`QQ native ${group ? 'group' : 'private'} callbacks acknowledge receipt before existing menu actions`, async () => {
    const gate = deferred();
    const started = deferred();
    const f = fixture({ group, execute: async () => { started.resolve(); await gate.promise; } });
    const event = f.event();
    const task = f.handle(event);
    await started.promise;
    assert.deepEqual(f.acknowledgements, [{ id: event.id, code: 0 }]);
    assert.deepEqual(f.order, ['ack', 'accept']);
    const message = f.messages[0];
    assert.deepEqual(message.replyTarget, { scope: group ? 'group' : 'c2c', targetId: group ? 'group-one' : 'owner', eventId: event.id });
    assert.equal(message.messageId, `qq-interaction:${event.id}`);
    assert.equal(message.replyTarget.msgId, undefined);
    assert.equal(message.senderId, 'owner');
    assert.equal(message.groupOpenid, group ? 'group-one' : undefined);
    gate.resolve();
    await task;
    assert.deepEqual(f.executed, ['/new']);
  });
}

test('QQ callback identity comes from platform fields and cannot use button_data or resolved.user_id', async () => {
  const f = fixture({ group: true });
  for (const changes of [
    { group_member_openid: 'other' },
    { group_openid: 'different-group' },
    { group_member_openid: '', data: { type: 11, resolved: {
      button_data: `/m pick ${f.entry.token} 1`, button_id: `${f.entry.token}_1`, user_id: 'owner',
    } } },
    { application_id: 'different-app' },
    { chat_type: 2 },
  ]) await f.handle(f.event(changes));
  assert.deepEqual(f.executed, []);
  assert.deepEqual(f.acknowledgements.map((item) => item.code), [4, 4, 1, 1, 1]);
  assert.equal(f.messages.length, 0);
  const privateFixture = fixture();
  await privateFixture.handle(privateFixture.event({ user_openid: 'other' }));
  assert.deepEqual(privateFixture.acknowledgements.map((item) => item.code), [4]);
  assert.deepEqual(privateFixture.executed, []);
});

test('QQ callback parser rejects malformed commands, mismatched button IDs and non-button events', () => {
  const f = fixture();
  for (const changes of [
    { type: 12 }, { version: 2 }, { version: null }, { version: '1' }, { data: { type: 1, resolved: {} } },
    { data: { type: 11, resolved: { button_data: '/new', button_id: 'other' } } },
    { data: { type: 11, resolved: { button_data: `/m pick ${f.entry.token} 1`, button_id: 'other' } } },
    { data: { type: 11, resolved: { button_data: `/m pick ${f.entry.token} 1`, button_id: null } } },
    { data: { type: 11, resolved: { button_data: `/m pick ${f.entry.token} 1`, button_id: ` ${f.entry.token}_1` } } },
    { scene: 'group' }, { chat_type: 0 },
  ]) assert.equal(qqMenuInteraction(f.event(changes), 'app').code, 1);
});

for (const group of [false, true]) {
  test(`QQ ${group ? 'group' : 'private'} buttons allow omitted button_id and default version`, async () => {
    for (const omitted of ['button_id', 'version', 'both']) {
      const f = fixture({ group });
      const event = f.event();
      if (omitted !== 'version') delete event.data.resolved.button_id;
      if (omitted !== 'button_id') delete event.version;
      assert.equal((await f.handle(event)).code, 0);
      assert.deepEqual(f.acknowledgements, [{ id: event.id, code: 0 }]);
      assert.deepEqual(f.executed, ['/new']);
    }
  });
}

test('QQ callback validates command permissions before ACK', async () => {
  const policy = directAccessPolicy({ users: [{ id: 'owner', canExecuteCommands: false }] });
  const f = fixture({ policy });
  await f.handle();
  assert.deepEqual(f.acknowledgements.map((item) => item.code), [4]);
  assert.deepEqual(f.executed, []);
  assert.equal(f.entry.used, false);
});

test('QQ callback refreshes expired and changed session/workspace without consuming or executing the old action', async () => {
  const expired = fixture();
  expired.advance(QQ_MENU_TTL_MS);
  await expired.handle();
  assert.equal(expired.acknowledgements[0].code, 0);
  assert.equal(expired.refreshed.length, 1);
  assert.deepEqual(expired.executed, []);
  assert.equal(expired.entry.used, false);
  for (const field of ['workspace', 'sessionWorkspace', 'sessionId']) {
    const f = fixture();
    f.context[field] = 'changed';
    await f.handle();
    assert.equal(f.acknowledgements[0].code, 0);
    assert.equal(f.refreshed.length, 1);
    assert.equal(f.entry.used, false);
    assert.deepEqual(f.executed, []);
  }
});

test('QQ stale callback recovery only reopens a safe menu after ACK and preserves its event reply target', async () => {
  for (const [group, reason] of [false, true].flatMap((group) =>
    ['expired', 'unknown-token', 'context-changed'].map((reason) => [group, reason]))) {
    const f = fixture({ group, inspect: () => ({ code: 1, error: 'stale menu', reason }) });
    const event = f.event();
    await Promise.all([f.handle(event), f.handle(event)]);
    assert.deepEqual(f.order, ['ack', 'accept']);
    assert.deepEqual(f.acknowledgements, [{ id: event.id, code: 0 }]);
    assert.deepEqual(f.executed, []);
    assert.equal(f.refreshed.length, 1);
    assert.equal(f.refreshed[0].content, '/m');
    assert.deepEqual(f.refreshed[0].raw, { content: '/m' });
    assert.deepEqual(f.refreshed[0].replyTarget, { scope: group ? 'group' : 'c2c', targetId: group ? 'group-one' : 'owner', eventId: event.id });
    assert.equal(f.entry.used, false);
  }
});

test('QQ callback permission and identity failures never refresh a menu', async () => {
  for (const reason of ['actor-mismatch', 'route-mismatch']) {
    const f = fixture({ inspect: () => ({ code: 4, error: 'private information', reason }) });
    await f.handle();
    assert.deepEqual(f.acknowledgements.map(({ code }) => code), [4]);
    assert.deepEqual(f.messages, []);
    assert.deepEqual(f.refreshed, []);
    assert.deepEqual(f.executed, []);
  }
  const policy = directAccessPolicy({ users: [{ id: 'owner', canExecuteCommands: false }] });
  const f = fixture({ policy, inspect: () => ({ code: 1, error: 'stale menu', reason: 'unknown-token' }) });
  await f.handle();
  assert.deepEqual(f.acknowledgements.map(({ code }) => code), [4]);
  assert.deepEqual(f.refreshed, []);
});

test('QQ invalid callbacks and nonrecoverable menu errors never enter a model or refresh', async () => {
  for (const reason of ['invalid-choice', 'unpublished', 'unrecognized-private-value']) {
    const f = fixture({ inspect: () => ({ code: 1, error: 'invalid menu', reason }) });
    await f.handle();
    assert.deepEqual(f.acknowledgements.map(({ code }) => code), [1]);
    assert.deepEqual(f.executed, []);
    assert.deepEqual(f.refreshed, []);
  }
  const f = fixture({ inspect: () => ({ code: 1, error: 'stale menu', reason: 'unknown-token' }) });
  await f.handle(f.event({ data: { type: 11, resolved: { button_data: 'send this to a model' } } }));
  assert.deepEqual(f.messages, []);
  assert.deepEqual(f.refreshed, []);
});

test('QQ interaction diagnostics contain only a fixed reason, ACK result and elapsed time', async () => {
  const f = fixture({ inspect: () => ({ code: 1, error: 'sensitive error', reason: 'unknown-token' }) });
  const event = f.event({ id: 'secret-event-id', application_id: 'app' });
  await f.handle(event);
  const decision = f.diagnostics.find(([label]) => label === '[dsh-im:qq] interaction decision:');
  assert.ok(decision);
  assert.equal(decision[1].reason, 'unknown-token');
  assert.equal(decision[1].ackCode, 0);
  assert.equal(decision[1].acknowledged, true);
  assert.equal(typeof decision[1].elapsedMs, 'number');
  const logged = JSON.stringify(f.diagnostics);
  for (const sensitive of ['secret-event-id', f.entry.token, 'sensitive error', 'button_data', 'owner']) {
    assert.equal(logged.includes(sensitive), false);
  }
  const failing = fixture({ ack: async () => { throw new Error('/interactions/secret-event-id owner secret-token'); } });
  await failing.handle();
  const failureLog = JSON.stringify(failing.diagnostics);
  for (const sensitive of ['secret-event-id', 'owner', 'secret-token']) assert.equal(failureLog.includes(sensitive), false);
  const unknown = fixture({ inspect: () => ({ code: 1, error: 'private error', reason: 'private-reason-value' }) });
  await unknown.handle();
  assert.equal(JSON.stringify(unknown.diagnostics).includes('private-reason-value'), false);
});

test('QQ callbacks ACK each event once and consume each menu once across retries and simultaneous clicks', async () => {
  const f = fixture();
  const event = f.event();
  await Promise.all([f.handle(event), f.handle(event), f.handle(f.event())]);
  assert.equal(f.acknowledgements.filter((item) => item.id === event.id).length, 1);
  assert.deepEqual(f.executed, ['/new']);
  await f.handle(f.event());
  assert.equal(f.acknowledgements.at(-1).code, 3);
  assert.match(f.messages.at(-1).text, /过期/);
  const count = f.acknowledgements.length;
  f.advance(QQ_MENU_TTL_MS + 1);
  await f.handle(event);
  assert.equal(f.acknowledgements.length, count, 'the same provider event is never acknowledged again');
});

test('QQ failed or uncertain ACK never runs business and never consumes the menu', async () => {
  const f = fixture({ ack: async () => { throw new Error('provider unavailable'); } });
  const event = f.event();
  assert.equal((await f.handle(event)).acknowledged, false);
  await f.handle(event);
  assert.equal(f.acknowledgements.length, 1);
  assert.equal(f.entry.used, false);
  assert.deepEqual(f.executed, []);
});

test('QQ callback ACK deadline and stop cancellation prevent late business', async () => {
  const stale = fixture();
  await stale.handle(stale.event(), { receivedAt: -3_000 });
  assert.equal(stale.acknowledgements.length, 0);
  assert.deepEqual(stale.executed, []);
  const lateAck = deferred();
  const timedOut = fixture({ acknowledgementDeadlineMs: 5, ack: async () => lateAck.promise });
  assert.equal((await timedOut.handle()).acknowledged, false);
  lateAck.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timedOut.entry.used, false);
  assert.deepEqual(timedOut.executed, []);
  assert.deepEqual(timedOut.refreshed, []);
  const staleAck = deferred();
  const staleMenu = fixture({ acknowledgementDeadlineMs: 5, ack: async () => staleAck.promise,
    inspect: () => ({ code: 1, error: 'stale menu', reason: 'unknown-token' }) });
  assert.equal((await staleMenu.handle()).acknowledged, false);
  staleAck.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(staleMenu.refreshed, []);
  const completedLate = fixture({ ack: async () => completedLate.advance(2_501) });
  assert.deepEqual(await completedLate.handle(), { code: 0, acknowledged: true, expired: true });
  assert.deepEqual(completedLate.executed, []);
  assert.deepEqual(completedLate.refreshed, []);
  const controller = new AbortController();
  const pendingAck = deferred();
  const f = fixture({ signal: controller.signal, ack: async () => pendingAck.promise });
  const task = f.handle();
  controller.abort();
  await task;
  pendingAck.resolve();
  assert.equal(f.entry.used, false);
  assert.deepEqual(f.executed, []);
});

test('QQ callback context must be the SDK event context for the current bot', async () => {
  const f = fixture();
  await f.handle(f.event(), { bot: {} });
  await f.handle(f.event(), { event: {} });
  await f.handle(f.event({ type: 13 }));
  assert.equal(f.acknowledgements.length, 0);
});
