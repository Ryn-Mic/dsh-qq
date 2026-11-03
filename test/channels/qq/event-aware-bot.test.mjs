import assert from 'node:assert/strict';
import test from 'node:test';
import { QQBot } from '@tencent-connect/qqbot-nodejs';
import { createEventAwareBot } from '../../../src/channels/qq/event-aware-bot.mjs';
import { qqMenuInteraction } from '../../../src/channels/qq/interaction-actions.mjs';
import { QqRuntime } from '../../../src/channels/qq/qq-runtime.mjs';
import { sendQqMenu } from '../../../src/channels/qq/qq-menu.mjs';
import { sendMarkdownReply } from '../../../src/channels/qq/markdown-reply.mjs';

const logger = { info() {}, warn() {}, error() {}, debug() {} };

function offlineFetch(t, { rejectMarkdownOnce = false } = {}) {
  const calls = [];
  let deniedPushes = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const parsed = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, path: parsed.pathname, method: init.method, body });
    if (parsed.hostname === 'bots.qq.com' && parsed.pathname === '/app/getAppAccessToken') {
      return Response.json({ access_token: 'synthetic-offline-token', expires_in: 7200 });
    }
    assert.equal(parsed.origin, 'https://api.sgroup.qq.com', 'all network traffic is intercepted');
    if (parsed.pathname.startsWith('/interactions/')) return Response.json({});
    assert.match(parsed.pathname, /^\/v2\/(?:users|groups)\/[^/]+\/messages$/u);
    if (!body.msg_id && !body.event_id) {
      deniedPushes++;
      return Response.json({ code: 400, message: 'Proactive push is not authorized' }, { status: 403 });
    }
    if (rejectMarkdownOnce && body.event_id && body.msg_type === 2 && !body.keyboard) {
      rejectMarkdownOnce = false;
      return Response.json({ code: 40034090, message: 'Markdown unsupported' }, { status: 403 });
    }
    return Response.json({ id: `offline-${calls.length}` });
  });
  return { calls, deniedPushes: () => deniedPushes,
    messages: () => calls.filter((call) => call.path.endsWith('/messages')) };
}

test('QQ event adapter preserves ordinary calls, SDK getters, and bound media methods', async () => {
  const calls = [];
  class SdkLike {
    #appId = 'synthetic-app';
    get appId() { return this.#appId; }
    send(request) { assert.equal(this.#appId, 'synthetic-app'); calls.push(request); return request; }
    sendText(target, content) { assert.equal(this.#appId, 'synthetic-app'); calls.push({ target, content }); }
    sendImage(target, source) { return { appId: this.#appId, target, source }; }
  }
  const native = new SdkLike();
  const bot = createEventAwareBot(native);
  assert.equal(bot.appId, 'synthetic-app');
  const target = { scope: 'c2c', targetId: 'owner', msgId: 'normal-message' };
  const request = { target, content: 'ordinary', extra: { custom: 'preserved' } };
  bot.send(request);
  bot.sendText(target, 'plain');
  assert.equal(calls[0], request);
  assert.equal(calls[1].target, target);
  const sendImage = bot.sendImage;
  assert.deepEqual(sendImage(target, { url: 'https://example.com/image.png' }), {
    appId: 'synthetic-app', target, source: { url: 'https://example.com/image.png' },
  });
  assert.equal(bot.sendImage, sendImage);
  assert.equal(createEventAwareBot({ sendText() {} }).send, undefined);
  assert.equal(bot.sendMarkdown, undefined);
});

test('real QQ SDK event replies carry event_id for text, menus, Markdown and plain fallback', async (t) => {
  const f = offlineFetch(t, { rejectMarkdownOnce: true });
  const native = new QQBot({ appId: 'synthetic-app', appSecret: 'synthetic-secret', logger, markdownSupport: false });
  const bot = createEventAwareBot(native);
  const target = { scope: 'c2c', targetId: 'owner', eventId: 'synthetic-event', msgId: 'must-not-leak' };
  await assert.rejects(native.sendText({ scope: 'c2c', targetId: 'owner' }, 'proactive'), /not authorized/u);
  await bot.sendText(target, 'first result');
  await bot.sendText(target, 'second result');
  await sendQqMenu(bot, target, { title: '菜单', entries: [{ label: '返回', action: { kind: 'command', text: '/m' } }] }, 'a'.repeat(24), { logger });
  await sendMarkdownReply(bot, target, '**event result**', { logger, requireComplete: true });
  await bot.sendMarkdown(target, '**SDK helper**');
  const messages = f.messages().slice(1);
  assert.equal(f.deniedPushes(), 1, 'only the deliberate proactive probe is denied');
  assert.equal(messages.length, 6);
  assert.deepEqual(messages.slice(0, 2).map((call) => call.body.msg_seq), [1, 2]);
  assert.ok(messages.some((call) => call.body.keyboard?.content.rows[0].buttons[0].action.type === 1));
  assert.ok(messages.some((call) => call.body.msg_type === 0 && call.body.content === '**event result**'));
  assert.ok(messages.some((call) => call.body.markdown?.content === '**SDK helper**'));
  for (const call of messages) {
    assert.equal(call.body.event_id, target.eventId);
    assert.equal(Object.hasOwn(call.body, 'msg_id'), false);
  }
});

for (const group of [false, true]) {
  test(`real QQ SDK ${group ? 'group' : 'private'} /m callback replies work with proactive delivery denied`, async (t) => {
    const f = offlineFetch(t);
    let native;
    let cleared = 0;
    const route = group ? 'group:group-one' : 'c2c:owner';
    const sessions = new Map([[route, 'session-one']]);
    const seen = new Set();
    const runtime = new QqRuntime({
      config: { appId: 'synthetic-app', botId: 'qq_bot', ownerUserOpenid: 'owner' },
      appSecret: 'synthetic-secret', logger, typingMiddleware: () => async (_ctx, next) => next(),
      state: { hasSeen: (id) => seen.has(id), markSeen: async (id) => { seen.add(id); },
        sessionFor: (key) => sessions.get(key) ?? null,
        clearSession: async (key) => { cleared++; sessions.delete(key); } },
      harness: { ensureRunning: async () => true, currentWorkspace: () => '/workspace',
        listWorkspaceSessions: async () => ({ sessions: [] }),
        listModels: async () => ({ current: {}, groups: [] }), agentPresetSettings: async () => ({}) },
      createBot: (options) => {
        // Use the SDK's custom transport port; no WebSocket or QQ connection
        // is opened. Every token/ACK/message fetch is intercepted above.
        const transport = { start: async () => {
          await native.emit('ready', {});
          await new Promise((resolve) => native.abortController.signal.addEventListener('abort', resolve, { once: true }));
        } };
        native = new QQBot({ ...options, transport });
        return native;
      },
    });
    t.after(() => runtime.stop());
    await runtime.start();
    await assert.rejects(native.sendText({ scope: group ? 'group' : 'c2c', targetId: group ? 'group-one' : 'owner' }, 'proactive probe'), /not authorized/u);
    await native.handleInboundMessage({ kind: group ? 'group' : 'c2c', senderId: 'owner',
      groupOpenid: group ? 'group-one' : undefined, messageId: 'normal-message', content: '/m',
      rawEventType: group ? 'GROUP_AT_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE' });
    const latestMenu = () => f.messages().findLast((call) => call.body.keyboard);
    let sequence = 0;
    const event = (menu, number) => {
      const button = menu.body.keyboard.content.rows.flatMap((row) => row.buttons)[number - 1];
      assert.equal(button.action.type, 1);
      return { id: `event-${++sequence}`, application_id: 'synthetic-app', version: 1, type: 11,
        scene: group ? 'group' : 'c2c', chat_type: group ? 1 : 2,
        ...(group ? { group_openid: 'group-one', group_member_openid: 'owner' } : { user_openid: 'owner' }),
        data: { type: 11, resolved: { button_id: button.id, button_data: button.action.data } } };
    };
    const dispatch = (value) => native.emit('interaction', { bot: native, event: value, state: {}, receivedAt: Date.now() }, value);
    const section = event(latestMenu(), 1);
    await dispatch(section);
    assert.equal(latestMenu().body.event_id, section.id);
    const back = event(latestMenu(), 1);
    await dispatch(back);
    assert.equal(latestMenu().body.event_id, back.id);
    const fresh = event(latestMenu(), 5);
    await dispatch(fresh);
    assert.equal(cleared, 1);
    const result = f.messages().findLast((call) => call.body.content?.includes('已开启新会话'));
    assert.equal(result.body.event_id, fresh.id);
    const repeat = { ...fresh, id: `event-${++sequence}` };
    await dispatch(repeat);
    assert.equal(f.messages().at(-1).body.event_id, repeat.id);
    assert.match(f.messages().at(-1).body.content, /过期/u);
    await sendMarkdownReply(createEventAwareBot(native), qqMenuInteraction(fresh, 'synthetic-app').target, '**callback Markdown**', { logger });
    const callbackMessages = f.messages().filter((call) => call.body.event_id);
    assert.equal(callbackMessages.length, 5);
    assert.equal(f.deniedPushes(), 1);
    assert.ok(callbackMessages.every((call) => !Object.hasOwn(call.body, 'msg_id')));
    assert.equal(callbackMessages.at(-1).body.markdown.content, '**callback Markdown**');
    assert.equal(callbackMessages.at(-1).body.event_id, fresh.id);
    assert.ok(callbackMessages.every((call) => call.path === `/v2/${group ? 'groups/group-one' : 'users/owner'}/messages`));
  });
}
