import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { typingIndicator } from '@tencent-connect/qqbot-nodejs';

import { QqRuntime } from '../../../src/channels/qq/qq-runtime.mjs';
import { rememberConnectionTestTarget } from '../../../src/channels/shared/connection-test.mjs';
import { directAccessPolicy } from '../access-policy-fixture.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

class FakeBot extends EventEmitter {
  middlewares = [];
  sent = [];
  stopped = false;
  use(value) { this.middlewares.push(value); }
  async start(signal) {
    queueMicrotask(() => this.emit('ready', {}));
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
  }
  stop() { this.stopped = true; }
  async sendText(target, text) { this.sent.push({ target, text }); }
}

test('QQ runtime preserves mention decisions through sanitization, typing and commands', async (t) => {
  const bot = new FakeBot();
  bot.appId = '123';
  const typing = [];
  const seen = new Set();
  const runtime = new QqRuntime({
    config: { botId: 'qq_bot', appId: '123', ownerUserOpenid: '*' }, appSecret: 'secret',
    harness: { ensureRunning: async () => true },
    state: { hasSeen: (id) => seen.has(id), markSeen: async (id) => seen.add(id) },
    createBot: () => bot,
    typingMiddleware: ({ predicate }) => async (ctx, next) => {
      typing.push(predicate(ctx));
      await next();
    },
  });
  t.after(() => runtime.stop());
  await runtime.start();
  bot.emit('ready', { user: { id: 'ready-self' } });
  bot.emit('resumed'); // A resume without user data must retain the verified identity.
  let sequence = 0;
  async function dispatch(content, fields = {}) {
    const ctx = { bot, message: {
      kind: 'group', rawEventType: 'GROUP_MESSAGE_CREATE', senderId: 'owner', groupOpenid: 'g',
      messageId: `runtime-mention-${++sequence}`, content, raw: { content },
      replyTarget: { scope: 'group', targetId: 'g', msgId: `runtime-mention-${sequence}` }, ...fields,
    } };
    let index = 0;
    const next = async () => {
      if (index < bot.middlewares.length) return bot.middlewares[index++](ctx, next);
      bot.emit('message', ctx, ctx.message);
    };
    await next();
    // Bridge scheduling is asynchronous; local status commands need no network.
    await new Promise((resolve) => setImmediate(resolve));
    return ctx.message;
  }
  for (const [content, fields] of [
    ['<@123> /status', {}],
    ['<@!ready-self> /status', {}],
    ['<@ABCDEF0123456789ABCDEF0123456789> /status', {
      mentions: [{ is_you: true, member_openid: 'ABCDEF0123456789ABCDEF0123456789' }],
    }],
    ['<@!ABCDEF0123456789ABCDEF0123456789> /status', {}],
  ]) {
    const count = bot.sent.length;
    const normalized = await dispatch(content, fields);
    assert.equal(normalized.content, '/status');
    assert.equal(typing.at(-1), true);
    assert.equal(bot.sent.length, count + 1);
    assert.match(bot.sent.at(-1).text, /连接正常/);
  }
  const count = bot.sent.length;
  for (const content of ['/status', '<@other> /status', '<@1234> /status']) {
    await dispatch(content);
    assert.equal(typing.at(-1), false);
    assert.equal(bot.sent.length, count);
  }
  // Recreating a runtime must not inherit IDs learned from a previous connection.
  await runtime.stop();
  bot.middlewares = [];
  await runtime.start();
  await dispatch('<@ABCDEF0123456789ABCDEF0123456789> /status');
  assert.equal(typing.at(-1), false);
  assert.equal(bot.sent.length, count);
});

test('QQ runtime waits for gateway ready, installs typing, and stops its client', async () => {
  const bot = new FakeBot();
  let botOptions;
  const sdkLogs = [];
  const runtime = new QqRuntime({
    config: { botId: 'qq_bot', appId: 'app', ownerUserOpenid: 'owner' },
    appSecret: 'secret',
    harness: { ensureRunning: async () => true },
    state: {},
    createBot: (options) => {
      botOptions = options;
      return bot;
    },
    logger: {
      debug: (...args) => sdkLogs.push(['debug', ...args]),
      info: (...args) => sdkLogs.push(['info', ...args]),
    },
    typingMiddleware: (options) => ({ name: 'typing-middleware', options }),
    connectTimeoutMs: 100,
  });
  const status = await runtime.start();
  assert.equal(status.ready, true);
  assert.equal(status.qqConnectionState, 'connected');
  assert.equal(typeof bot.middlewares[0], 'function'); // mention normalization
  assert.equal(typeof bot.middlewares[1], 'function'); // contentSanitizer (face-tag parsing)
  assert.equal(bot.middlewares[2].name, 'typing-middleware');
  assert.equal(bot.middlewares[2].options.keepAlive, true);
  assert.equal(bot.middlewares[2].options.predicate({ message: { senderId: 'owner' } }), true);
  assert.equal(bot.middlewares[2].options.predicate({ message: { senderId: 'other' } }), false);
  assert.equal(botOptions.markdownSupport, false);
  assert.equal(botOptions.intents, undefined, 'the SDK default includes native interaction events');
  botOptions.logger.debug('raw gateway payload');
  botOptions.logger.info('gateway ready');
  assert.deepEqual(sdkLogs, [['info', 'gateway ready']]);
  bot.emit('error', new Error('temporary disconnect'));
  bot.emit('resumed');
  assert.equal(runtime.status.ready, true);
  assert.equal(runtime.status.lastError, null);
  await runtime.stop();
  assert.equal(bot.stopped, true);
  assert.equal(runtime.status.ready, false);
});

test('QQ runtime never reports ready when the gateway does not emit ready', async () => {
  const bot = new FakeBot();
  bot.start = async (signal) => new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
  const runtime = new QqRuntime({
    config: { botId: 'qq_bot', appId: 'app', ownerUserOpenid: 'owner' },
    appSecret: 'secret',
    harness: { ensureRunning: async () => true },
    state: {},
    createBot: () => bot,
    typingMiddleware: () => 'typing',
    connectTimeoutMs: 5,
  });
  await assert.rejects(() => runtime.start(), /did not become ready/);
  assert.equal(runtime.status.ready, false);
});

test('QQ runtime sends a proactive connection test to the explicit owner fallback', async () => {
  const bot = new FakeBot();
  const runtime = new QqRuntime({
    config: { botId: 'qq_bot', appId: 'app', ownerUserOpenid: 'owner-openid' },
    appSecret: 'secret',
    harness: { ensureRunning: async () => true },
    state: {},
    createBot: () => bot,
    typingMiddleware: () => 'typing',
    connectTimeoutMs: 100,
  });

  await runtime.start();
  assert.deepEqual(await runtime.sendConnectionTest('connection-test'), { sent: true });
  assert.deepEqual(bot.sent, [{
    target: { scope: 'c2c', targetId: 'owner-openid' },
    text: 'connection-test',
  }]);
  await runtime.sendProactiveText({
    kind: 'group',
    route: { groupOpenId: 'group-openid' },
  }, 'proactive-test');
  assert.deepEqual(bot.sent[1], {
    target: { scope: 'group', targetId: 'group-openid' },
    text: 'proactive-test',
  });
  const rich = [];
  bot.send = async request => { rich.push(request); return { id: 'rich-1' }; };
  await runtime.sendProactiveText({ kind: 'user', route: { userOpenId: 'owner-openid' } },
    '**answer**', { format: 'markdown' });
  assert.equal(rich[0].msgType, 2);
  assert.equal(rich[0].markdown.content, '**answer**');
  assert.deepEqual(rich[0].target, { scope: 'c2c', targetId: 'owner-openid' });
  await runtime.stop();
});

test('QQ runtime requires a remembered private target for wildcard owners and strips the reply id', async () => {
  const bot = new FakeBot();
  const state = {};
  const runtime = new QqRuntime({
    config: { botId: 'qq_bot', appId: 'app', ownerUserOpenid: '*' },
    appSecret: 'secret',
    harness: { ensureRunning: async () => true },
    state,
    createBot: () => bot,
    typingMiddleware: () => 'typing',
    connectTimeoutMs: 100,
  });

  await runtime.start();
  await assert.rejects(
    () => runtime.sendConnectionTest('unavailable'),
    (error) => error?.code === 'test-target-unavailable',
  );
  rememberConnectionTestTarget(state, {
    scope: 'c2c', targetId: 'recent-user', msgId: 'old-inbound-message',
  });
  await runtime.sendConnectionTest('remembered-target');
  assert.deepEqual(bot.sent, [{
    target: { scope: 'c2c', targetId: 'recent-user' },
    text: 'remembered-target',
  }]);
  await runtime.stop();
});

test('QQ runtime aborts an in-flight Harness interaction when stopped', async () => {
  const bot = new FakeBot();
  const askStarted = deferred();
  let askSignal;
  const runtime = new QqRuntime({
    config: { botId: 'qq_bot', appId: 'app', ownerUserOpenid: 'owner' },
    appSecret: 'secret',
    harness: {
      ensureRunning: async () => true,
      sessionExists: async () => true,
      ask: async (_sessionId, _text, options) => {
        askSignal = options.signal;
        askStarted.resolve();
        await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => {
          reject(options.signal.reason);
        }, { once: true }));
      },
    },
    state: {
      hasSeen: () => false,
      markSeen: async () => {},
      sessionFor: () => 'session-existing',
      setSession: async () => {},
      clearSession: async () => {},
    },
    createBot: () => bot,
    typingMiddleware: () => 'typing',
    connectTimeoutMs: 100,
    logger: { error() {}, warn() {}, info() {} },
  });

  await runtime.start();
  bot.emit('message', {}, {
    kind: 'c2c',
    rawEventType: 'C2C_MESSAGE_CREATE',
    senderId: 'owner',
    senderIsBot: false,
    content: '需要交互',
    messageId: 'interaction-message',
    replyTarget: { scope: 'c2c', targetId: 'owner', msgId: 'interaction-message' },
  });
  await askStarted.promise;
  assert.equal(askSignal.aborted, false);
  bot.emit('message', {}, {
    kind: 'c2c',
    rawEventType: 'C2C_MESSAGE_CREATE',
    senderId: 'owner',
    senderIsBot: false,
    content: '排队中的下一条消息',
    messageId: 'queued-message',
    replyTarget: { scope: 'c2c', targetId: 'owner', msgId: 'queued-message' },
  });
  await runtime.stop();
  assert.equal(askSignal.aborted, true);
});

test('QQ runtime enables result-file delivery without per-bot configuration', async () => {
  const bot = new FakeBot();
  const askObserved = deferred();
  let onArtifact;
  const runtime = new QqRuntime({
    config: { botId: 'qq_bot', appId: 'app', ownerUserOpenid: 'owner' },
    appSecret: 'secret',
    harness: {
      ensureRunning: async () => true,
      sessionExists: async () => true,
      ask: async (_sessionId, _text, options) => {
        onArtifact = options.onArtifact;
        askObserved.resolve();
        return '完成';
      },
    },
    state: {
      hasSeen: () => false,
      markSeen: async () => {},
      sessionFor: () => 'session-existing',
      setSession: async () => {},
      clearSession: async () => {},
    },
    createBot: () => bot,
    typingMiddleware: () => 'typing',
    connectTimeoutMs: 100,
  });

  await runtime.start();
  bot.emit('message', {}, {
    kind: 'c2c',
    rawEventType: 'C2C_MESSAGE_CREATE',
    senderId: 'owner',
    senderIsBot: false,
    content: '生成文件',
    messageId: 'qq-artifact-gate',
    replyTarget: { scope: 'c2c', targetId: 'owner', msgId: 'qq-artifact-gate' },
  });
  await askObserved.promise;
  assert.equal(typeof onArtifact, 'function');
  await runtime.stop();
});

test('QQ message handlers keep SDK typing alive through work and cancel it on stop', async (t) => {
  const bot = new FakeBot();
  const started = deferred();
  let typingCount = 0;
  let askSignal;
  bot.sendTyping = async () => { typingCount++; };
  const runtime = new QqRuntime({
    config: { botId: 'qq_bot', appId: 'app', ownerUserOpenid: 'owner' }, appSecret: 'secret',
    harness: { ensureRunning: async () => true, sessionExists: async () => true,
      ask: async (_id, _text, { signal }) => {
        askSignal = signal; started.resolve();
        await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      } },
    state: { hasSeen: () => false, markSeen: async () => {}, sessionFor: () => 'session-existing' },
    createBot: () => bot,
    typingMiddleware: (options) => typingIndicator({ ...options, keepAliveIntervalMs: 5 }),
    logger: { error() {}, warn() {}, info() {} },
  });
  t.after(() => runtime.stop());
  await runtime.start();
  const message = { kind: 'c2c', senderId: 'owner', content: '长任务', messageId: 'typing-task',
    rawEventType: 'C2C_MESSAGE_CREATE', replyTarget: { scope: 'c2c', targetId: 'owner', msgId: 'typing-task' } };
  const ctx = { bot, message, replyTarget: message.replyTarget, log: { debug() {} } };
  let index = 0;
  const next = async () => index < bot.middlewares.length
    ? bot.middlewares[index++](ctx, next)
    : bot.listeners('message')[0](ctx, ctx.message);
  let settled = false;
  const dispatch = next().finally(() => { settled = true; });
  await started.promise;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(settled, false);
  assert.ok(typingCount > 1, 'typing keepalive remains active while the handler Promise is pending');
  await runtime.stop();
  await dispatch;
  assert.equal(askSignal.aborted, true);
  const countAfterStop = typingCount;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(typingCount, countAfterStop);
});

async function callbackRuntime(t, { group = false, policy, onAck, buttonNumber = 5 } = {}) {
  const bot = new FakeBot();
  bot.gateway = { currentWs: new EventEmitter() };
  const acks = [];
  const route = group ? 'group:group-one' : 'c2c:owner';
  const sessions = new Map([[route, 'session-original']]);
  const seen = new Set();
  let cleared = 0;
  const state = {
    hasSeen: (id) => seen.has(id), markSeen: async (id) => { seen.add(id); },
    sessionFor: (key) => sessions.get(key) ?? null,
    clearSession: async (key) => { cleared++; sessions.delete(key); },
  };
  bot.send = async (request) => { bot.sent.push(request); return { id: `sent-${bot.sent.length}` }; };
  bot.api = { getToken: async () => 'synthetic-access-token' };
  bot.acknowledgeInteraction = async () => { throw new Error('SDK JSON-only acknowledgement must not be used'); };
  let sequence = 0;
  const runtime = new QqRuntime({
    config: { botId: 'qq_bot', appId: 'app', ownerUserOpenid: 'owner' }, appSecret: 'secret',
    harness: { ensureRunning: async () => true, currentWorkspace: () => '/workspace',
      listWorkspaceSessions: async () => ({ sessions: [] }),
      listModels: async () => ({ current: {}, groups: [] }), agentPresetSettings: async () => ({}) },
    state, accessPolicy: policy, createBot: (options) => {
      bot.protocolLogger = options.logger;
      return bot;
    }, typingMiddleware: () => async (_ctx, next) => next(),
    interactionFetchImpl: async (url, options) => {
      assert.equal(options.method, 'PUT');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'QQBot synthetic-access-token');
      const path = new URL(url);
      assert.equal(path.origin, 'https://api.sgroup.qq.com');
      const id = decodeURIComponent(path.pathname.slice('/interactions/'.length));
      const { code } = JSON.parse(options.body);
      acks.push({ id, code });
      await onAck?.(id, code);
      return new Response(null, { status: 204 });
    },
    logger: { info() {}, warn() {}, error() {} },
  });
  t.after(() => runtime.stop());
  await runtime.start();
  const message = { kind: group ? 'group' : 'c2c', senderId: 'owner', content: '/m', messageId: 'open-menu',
    groupOpenid: group ? 'group-one' : undefined,
    rawEventType: group ? 'GROUP_AT_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
    replyTarget: { scope: group ? 'group' : 'c2c', targetId: group ? 'group-one' : 'owner', msgId: 'open-menu' } };
  await bot.listeners('message')[0]({ bot, message }, message);
  const menu = bot.sent.find((entry) => entry.keyboard);
  const button = menu.keyboard.content.rows.flatMap((row) => row.buttons)[buttonNumber - 1];
  const event = (changes = {}) => ({ id: `callback-${++sequence}`, application_id: 'app', type: 11, version: 1,
    scene: group ? 'group' : 'c2c', chat_type: group ? 1 : 2,
    ...(group ? { group_openid: 'group-one', group_member_openid: 'owner' } : { user_openid: 'owner' }),
    data: { type: 11, resolved: { button_id: button.id, button_data: button.action.data } }, ...changes });
  const callback = (value = event()) => {
    bot.gateway.currentWs.emit('message', Buffer.from(JSON.stringify({
      op: 0, t: 'INTERACTION_CREATE', id: `frame:${value.id}:opaque`, d: value,
    })));
    return bot.listeners('interaction')[0]({ bot, event: value, state: {}, receivedAt: Date.now() }, value);
  };
  return { bot, runtime, acks, state, route, event, callback, cleared: () => cleared };
}

for (const group of [false, true]) {
  for (const [name, buttonNumber, title] of [['models', 4, /🧠 模型/u], ['help', 13, /📖 帮助/u]]) {
    test(`QQ runtime replies to ${group ? 'group' : 'private'} ${name} navigation after an empty 204 ACK`, async (t) => {
      const f = await callbackRuntime(t, { group, buttonNumber });
      const event = f.event();
      await f.callback(event);
      assert.deepEqual(f.acks, [{ id: event.id, code: 0 }]);
      const reply = f.bot.sent.at(-1);
      assert.match(reply.markdown.content, title);
      assert.ok(reply.keyboard.content.rows.length);
      assert.equal(reply.extra.event_id, `frame:${event.id}:opaque`);
      assert.equal(reply.target.msgId, undefined);
      assert.equal(f.cleared(), 0);
    });
  }
  test(`QQ runtime connects native ${group ? 'group' : 'private'} callbacks to existing menu commands`, async (t) => {
    const f = await callbackRuntime(t, { group });
    assert.equal(f.bot.listenerCount('interaction'), 1);
    await f.callback(f.event(group ? { group_member_openid: 'other' } : { user_openid: 'other' }));
    if (group) await f.callback(f.event({ group_openid: 'other-group' }));
    assert.equal(f.cleared(), 0);
    assert.ok(f.acks.every((item) => item.code === 4));
    const valid = f.event();
    await f.callback(valid);
    await f.callback(valid);
    assert.equal(f.state.sessionFor(f.route), null);
    assert.equal(f.cleared(), 1);
    assert.equal(f.acks.filter((item) => item.id === valid.id).length, 1);
    const result = f.bot.sent.find((entry) => entry.content?.includes('已开启新会话'));
    assert.deepEqual(result.target, { scope: group ? 'group' : 'c2c', targetId: group ? 'group-one' : 'owner' });
    assert.equal(result.extra.event_id, `frame:${valid.id}:opaque`);
    assert.equal(result.target.msgId, undefined);
    await f.callback();
    assert.equal(f.acks.at(-1).code, 3);
    assert.equal(f.cleared(), 1);
  });
}

test('QQ runtime requires a captured Gateway envelope rather than caller-supplied transport metadata', async (t) => {
  const f = await callbackRuntime(t);
  const event = f.event();
  await f.bot.listeners('interaction')[0]({
    bot: f.bot, event, receivedAt: Date.now(), transportEventId: 'untrusted-transport-id',
  }, event);
  assert.equal(f.cleared(), 0);
  assert.equal(f.acks.at(-1).code, 1);
});

test('QQ runtime captures replayed interactions before RESUMED and removes socket listeners on stop', async (t) => {
  const f = await callbackRuntime(t, { buttonNumber: 13 });
  const previousSocket = f.bot.gateway.currentWs;
  assert.equal(previousSocket.listenerCount('message'), 1);
  const replacement = new EventEmitter();
  f.bot.gateway.currentWs = replacement;
  f.bot.protocolLogger.info('synthetic socket opened');
  assert.equal(previousSocket.listenerCount('message'), 0);
  assert.equal(replacement.listenerCount('message'), 1);
  const event = f.event();
  await f.callback(event);
  assert.equal(f.bot.sent.at(-1).extra.event_id, `frame:${event.id}:opaque`);
  f.bot.emit('resumed');
  assert.equal(replacement.listenerCount('message'), 1);
  await f.runtime.stop();
  assert.equal(replacement.listenerCount('message'), 0);
});

test('QQ callback executes the normal bridge permission recheck after ACK', async (t) => {
  const policy = directAccessPolicy({ users: [{ id: 'owner', canExecuteCommands: true }] });
  const f = await callbackRuntime(t, { policy, onAck: async () => {
    policy.getSettings().direct.allowlist.users[0].canExecuteCommands = false;
  } });
  await f.callback();
  assert.equal(f.acks[0].code, 0);
  assert.equal(f.cleared(), 0);
  assert.match(f.bot.sent.at(-1).content, /没有执行命令的权限/);
});
