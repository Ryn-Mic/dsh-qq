import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, QQBot } from '@tencent-connect/qqbot-nodejs';
import { QqHarnessBridge } from '../../../src/channels/qq/qq-bridge.mjs';
import { openQqReplyStream } from '../../../src/channels/qq/qq-stream-delivery.mjs';
import { HarnessReplyTracker } from '../../../src/channels/shared/harness-client.mjs';

const target = { scope: 'c2c', targetId: 'synthetic-user', msgId: 'synthetic-trigger' };
const logger = { warn() {}, error() {} };

function bridgeFixture({ enabled = false, stream, ask, kind = 'c2c', timeoutMs = 100 } = {}) {
  const markdown = [], notices = [], opened = [];
  const message = {
    kind, rawEventType: kind === 'group' ? 'GROUP_AT_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
    senderId: target.targetId, groupOpenid: 'synthetic-group', senderIsBot: false,
    content: '请回答', messageId: target.msgId,
    replyTarget: kind === 'group' ? { scope: 'group', targetId: 'synthetic-group', msgId: target.msgId } : target,
  };
  const bot = {
    sendText: async (_route, text) => notices.push(text),
    send: async (value) => { markdown.push(value); return { id: 'synthetic-markdown' }; },
    openStream: (options) => { opened.push(options); if (stream instanceof Error) throw stream; return stream; },
  };
  const bridge = new QqHarnessBridge({
    bot, ownerUserOpenid: '*', logger, streamingEnabled: enabled, streamingTimeoutMs: timeoutMs,
    harness: { sessionExists: async () => true, ask: ask ?? (async () => '最终回答') },
    state: { hasSeen: () => false, markSeen: async () => {}, sessionFor: () => 'synthetic-session', setSession: async () => {} },
  });
  return { bridge, message, markdown, notices, opened };
}

test('QQ explicit streaming routes model text updates through the real SDK and closes a DONE frame', async () => {
  const frames = [];
  const bot = new QQBot({ appId: 'synthetic-app', appSecret: 'synthetic-secret' });
  bot.tokenManager.getAccessToken = async () => 'synthetic-token';
  bot.apiClient.request = async (_token, method, path, body) => {
    frames.push({ method, path, body }); return { id: 'synthetic-stream-id' };
  };
  const stream = await openQqReplyStream(bot, target, { enabled: true, timeoutMs: 100 });
  await stream.updateProgress('最终');
  await stream.updateProgress('最终回答');
  const result = await stream.finish('最终回答');
  assert.equal(result.fallback, false);
  assert.equal(result.response.id, 'synthetic-stream-id');
  assert.equal(frames[0].path, '/v2/users/synthetic-user/stream_messages');
  assert.equal(frames[0].body.msg_id, target.msgId);
  assert.equal(frames[0].body.input_state, 1);
  assert.equal(frames.at(-1).body.input_state, 10);
  assert.equal(frames.at(-1).body.content_raw, '最终回答');
  assert.equal(frames.at(-1).body.stream_msg_id, 'synthetic-stream-id');
});

function sdkWithPrefixGuard() {
  const frames = [];
  let visible = '';
  const bot = new QQBot({ appId: 'synthetic-app', appSecret: 'synthetic-secret' });
  bot.tokenManager.getAccessToken = async () => 'synthetic-token';
  bot.apiClient.request = async (_token, method, path, body) => {
    frames.push({ method, path, body: structuredClone(body) });
    if (path.endsWith('/stream_messages')) {
      if (!body.content_raw.startsWith(visible)) {
        throw new ApiError('The sent stream prefix cannot be changed', 400, path, 40007);
      }
      visible = body.content_raw;
      return { id: 'prefix-safe-stream' };
    }
    return { id: 'synthetic-non-stream-message' };
  };
  const open = bot.openStream.bind(bot);
  // Deterministically queue every update after the first. complete() clears
  // this timer and is the first HTTP call to observe the final pending text.
  bot.openStream = (options) => open({ ...options, throttleMs: 60_000 });
  return { bot, frames, visible: () => visible };
}

for (const rewriteFinalDraft of [false, true]) {
  test(`QQ real Harness tracker preserves tool preambles and the complete final answer through SDK-throttled DONE${rewriteFinalDraft ? ' after a canonical rewrite' : ''}`, async () => {
    const { bot, frames, visible } = sdkWithPrefixGuard();
    const finalAnswer = '最终答案：测试通过。';
    const text = (value) => ({ type: 'text', text: value });
    const events = [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { turn: 1, source: { rpcId: 'stream-tool-turn' } } },
      { type: 'assistant/message', data: { turn: 1, step: 0, message: { content: [text('正在检查工具。'), { type: 'tool-call', name: 'bash', callId: 'call-1' }] } } },
      { type: 'tool/call', data: { turn: 1, step: 0, name: 'bash', callId: 'call-1' } },
      ...(rewriteFinalDraft ? [{ type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '尚未定稿。' } } }] : []),
      { type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [text(finalAnswer)] } } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ].map((event, seq) => ({ ...event, seq }));
    let tracker;
    const bridge = new QqHarnessBridge({
      bot, ownerUserOpenid: '*', streamingEnabled: true, logger,
      harness: { sessionExists: async () => true, ask: async (_id, _text, options) => {
        tracker = new HarnessReplyTracker({ promptRpcId: 'stream-tool-turn', finalAnswerOnly: options.finalAnswerOnly });
        for (const event of events) {
          for (const update of tracker.consumeAll([event])) await options.onUpdate(update);
        }
        // The real tracker deliberately removes the tool preamble here while
        // type=text progress retained it. The stream must not remove it too.
        assert.equal(tracker.finalAnswer, finalAnswer);
        assert.equal(tracker.answer, `正在检查工具。\n\n${finalAnswer}`);
        return tracker.finalAnswer;
      } },
      state: { hasSeen: () => false, markSeen: async () => {}, sessionFor: () => 'synthetic-session', setSession: async () => {} },
    });
    const receipt = await bridge.accept({ kind: 'c2c', rawEventType: 'C2C_MESSAGE_CREATE', senderId: target.targetId,
      senderIsBot: false, content: '请检查', messageId: target.msgId, replyTarget: target });
    assert.deepEqual(frames.map(({ body }) => body.input_state), [1, 10]);
    assert.ok(visible().startsWith('正在检查工具。'));
    assert.ok(visible().endsWith(finalAnswer));
    assert.equal(visible().split(finalAnswer).length - 1, 1);
    assert.deepEqual(receipt?.providerMessageIds, ['prefix-safe-stream']);
    assert.equal(bridge.status.lastMessageError, null);
    assert.equal(bridge.status.messagesReplied, 1);
  });
}

test('QQ bridge streaming is opt-in, C2C-only and ignores tool/status text', async () => {
  const updates = [], completions = [];
  const stream = { update: async (text) => updates.push(text), complete: async () => { completions.push(true); return { id: 'stream-answer' }; }, cancel() {} };
  const f = bridgeFixture({ enabled: true, stream, ask: async (_id, _text, options) => {
    await options.onUpdate({ type: 'text', text: '最终' });
    await options.onUpdate({ type: 'status', text: '不发送工具状态' });
    await options.onUpdate({ type: 'reasoning', text: '不发送推理' });
    await options.onUpdate({ type: 'text', text: '最终回答' });
    return '最终回答';
  } });
  const receipt = await f.bridge.accept(f.message);
  assert.deepEqual(f.opened, [{ target }]);
  assert.deepEqual(updates, ['最终', '最终回答', '最终回答']);
  assert.equal(completions.length, 1);
  assert.equal(f.markdown.length, 0);
  assert.deepEqual(receipt.providerMessageIds, ['stream-answer']);
  for (const options of [{ enabled: false }, { enabled: true, kind: 'group' }]) {
    const disabled = bridgeFixture({ ...options, stream });
    await disabled.bridge.accept(disabled.message);
    assert.equal(disabled.opened.length, 0);
    assert.equal(disabled.markdown.length, 1);
  }
});

test('QQ streaming setter affects the next turn without cancelling the current delivery', async () => {
  let bridge;
  const f = bridgeFixture({ enabled: true, stream: { update: async () => {}, complete: async () => ({ id: 'stream-one' }), cancel() {} },
    ask: async () => { bridge.setStreamingEnabled(false); return '最终回答'; } });
  bridge = f.bridge;
  await bridge.accept(f.message);
  await bridge.accept({ ...f.message, messageId: 'second', replyTarget: { ...target, msgId: 'second' } });
  assert.equal(f.opened.length, 1);
  assert.equal(f.markdown.length, 1);
  assert.throws(() => bridge.setStreamingEnabled('true'), /boolean/u);
});

test('QQ explicit stream-open failure and definite update rejection use one final Markdown fallback', async () => {
  const rejected = new ApiError('unsupported stream', 400, '/stream_messages', 40007);
  for (const stream of [new Error('synthetic open failure'), { update: async () => { throw rejected; }, complete: async () => assert.fail('rejected stream was completed'), cancel() {} }]) {
    const f = bridgeFixture({ enabled: true, stream,
      ask: async (_id, _text, { onUpdate }) => { await onUpdate({ type: 'text', text: '预览' }); return '最终回答'; } });
    await f.bridge.accept(f.message);
    assert.equal(f.markdown.length, 1);
    assert.equal(f.markdown[0].markdown.content, '最终回答');
  }
});

test('QQ uncertain stream progress, final update or DONE never duplicates the answer as Markdown', async () => {
  for (const failAt of ['progress', 'final', 'complete']) {
    const sent = [];
    const stream = {
      update: async (text) => { sent.push(text); if (failAt === (text === '预览' ? 'progress' : 'final')) throw new Error('synthetic lost acknowledgement'); },
      complete: async () => { if (failAt === 'complete') throw new Error('synthetic lost DONE'); return { id: 'stream' }; },
      cancel() {},
    };
    const f = bridgeFixture({ enabled: true, stream,
      ask: async (_id, _text, { onUpdate }) => { await onUpdate({ type: 'text', text: '预览' }); return '最终回答'; } });
    await f.bridge.accept(f.message);
    assert.equal(f.markdown.length, 0, failAt);
    assert.equal(f.notices.some((text) => text === '最终回答'), false, failAt);
    assert.ok(f.bridge.status.lastMessageError, failAt);
    assert.equal(sent.filter((text) => text.includes('最终回答')).length, failAt === 'progress' ? 0 : 1);
  }
});

test('QQ hung stream calls have a bounded timeout, cancel timers and never send fallback duplicates', async () => {
  let cancelled = 0;
  const stream = await openQqReplyStream({ openStream: () => ({ update: async () => new Promise(() => {}), complete: async () => assert.fail('timed-out stream completed'), cancel: () => { cancelled += 1; } }) }, target,
    { enabled: true, timeoutMs: 10, logger });
  await stream.updateProgress('预览');
  await assert.rejects(stream.finish('最终回答'), { code: 'qq-delivery-uncertain' });
  assert.equal(cancelled, 1);
});

test('QQ callback event_id targets never enter a msg_id-only SDK stream', async () => {
  let calls = 0;
  const bot = { openStream: () => { calls += 1; } };
  for (const eventTarget of [{ scope: 'c2c', targetId: target.targetId, eventId: 'event-only' }, { ...target, eventId: 'event-takes-precedence' }]) {
    assert.equal(await openQqReplyStream(bot, eventTarget, { enabled: true }), null);
  }
  assert.equal(calls, 0);
});
