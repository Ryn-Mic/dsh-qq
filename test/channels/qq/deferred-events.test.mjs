import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QqHarnessBridge, deferredDeliveryTarget } from '../../../src/channels/qq/qq-bridge.mjs';
import { QqStateStore } from '../../../src/channels/qq/state-store.mjs';
import { createEventAwareBot } from '../../../src/channels/qq/event-aware-bot.mjs';

test('QQ deferred callback replies retain eventId separately and expire the passive anchor', () => {
  const receivedAt = Date.now();
  const target = { scope: 'c2c', targetId: 'synthetic-user', eventId: 'callback-event', msgId: 'must-not-be-used', receivedAt };
  assert.deepEqual(deferredDeliveryTarget(target, receivedAt + 60_000),
    { scope: 'c2c', targetId: 'synthetic-user', eventId: 'callback-event' });
  assert.deepEqual(deferredDeliveryTarget(target, receivedAt + 60 * 60_000),
    { scope: 'c2c', targetId: 'synthetic-user' });
});

test('QQ callback deferred final delivery survives persisted state and uses event_id instead of a proactive push', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-qq-deferred-event-'));
  const signal = new AbortController();
  const calls = [], listeners = [];
  const turnStart = { seq: 1, type: 'turn/start', data: { turn: 3 } };
  const user = { seq: 2, type: 'user/message', data: { turn: 3, source: { rpcId: 'synthetic-prompt' } } };
  const end = { seq: 4, type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } };
  let history = [turnStart, user];
  const state = await new QqStateStore(join(directory, 'state.json')).load();
  await state.setSession('c2c:synthetic-user', 'synthetic-session');
  const harness = {
    ensureRunning: async () => true, sessionExists: async () => true,
    ask: async () => { throw Object.assign(new Error('synthetic model wait timeout'), {
      code: 'harness-reply-timeout', details: { sessionId: 'synthetic-session', promptRpcId: 'synthetic-prompt', turn: 3, baselineSeq: 0 },
    }); },
    rpc: async () => ({ events: history, hasMore: false }),
    watchHarnessEvents: (listener) => { listeners.push(listener); },
  };
  harness.workspaceSession = (sessionId) => ({ sessionId, sessionExists: harness.sessionExists, ask: harness.ask });
  const bot = createEventAwareBot({
    sendText: async () => assert.fail('An event reply must use the SDK send escape hatch'),
    send: async (request) => { calls.push(request); return { id: `event-result-${calls.length}` }; },
  });
  const bridge = new QqHarnessBridge({ bot, ownerUserOpenid: '*', harness, state, signal: signal.signal,
    logger: { warn() {}, error() {} } });
  t.after(async () => { signal.abort(); await bridge.waitForIdle(); await rm(directory, { recursive: true, force: true }); });
  await bridge.accept({ kind: 'c2c', rawEventType: 'C2C_MESSAGE_CREATE', senderId: 'synthetic-user', senderIsBot: false,
    messageId: 'callback-event', content: '请检查', replyTarget: { scope: 'c2c', targetId: 'synthetic-user', eventId: 'callback-event' } });
  await bridge.waitForIdle();
  assert.equal(state.deferredEntries().length, 1);
  const saved = await new QqStateStore(join(directory, 'state.json')).load();
  assert.equal(saved.deferredEntries()[0].target.eventId, 'callback-event');
  assert.equal('msgId' in saved.deferredEntries()[0].target, false);
  history = [turnStart, user, { seq: 3, type: 'assistant/message', data: { turn: 3, step: 0,
    message: { content: [{ type: 'text', text: '最终回调结果' }] } } }, end];
  await listeners.at(-1).onSessionEvent({ sessionId: 'synthetic-session', event: end });
  await bridge.waitForIdle();
  const result = calls.find((call) => call.markdown?.content === '最终回调结果');
  assert.ok(result);
  assert.equal(result.extra.event_id, 'callback-event');
  assert.equal('msg_id' in result.extra, false);
  assert.equal('msgId' in result.target, false);
  assert.deepEqual(state.deferredEntries(), []);
});
