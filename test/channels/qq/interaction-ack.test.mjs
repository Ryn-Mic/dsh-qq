import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { WebSocketServer } from 'ws';
import { QQBot } from '@tencent-connect/qqbot-nodejs';
import { acknowledgeQqInteraction } from '../../../src/channels/qq/interaction-ack.mjs';
import { createQqInteractionHandler } from '../../../src/channels/qq/interaction-actions.mjs';
import { createEventAwareBot } from '../../../src/channels/qq/event-aware-bot.mjs';
import { createQqInteractionEnvelopeTracker } from '../../../src/channels/qq/interaction-envelope.mjs';

const logger = { info() {}, warn() {}, error() {}, debug() {} };

async function offlineGateway(t, { status = 204, body = '', delay = 0, abortOnAck = false, networkFailure = false,
  beforeReady = false, resume = false } = {}) {
  const calls = [];
  const timers = new Set();
  const actionController = new AbortController();
  const connectionController = new AbortController();
  const event = { id: 'offline-interaction', application_id: 'offline-app', type: 11, chat_type: 2,
    scene: 'c2c', version: 1, user_openid: 'offline-owner', data: { type: 11, resolved: {
      button_data: '/m pick 0123456789abcdef01234567 1', button_id: '0123456789abcdef01234567_1',
    } } };
  let intents;
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (req.url === '/app/getAppAccessToken') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ access_token: 'offline-access', expires_in: 7200 }));
      return;
    }
    if (req.url === '/gateway') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ url: `ws://127.0.0.1:${server.address().port}` }));
      return;
    }
    calls.push({ path: req.url, method: req.method, body: raw ? JSON.parse(raw) : undefined });
    if (req.url.startsWith('/interactions/')) {
      if (abortOnAck) actionController.abort(new Error('offline cancellation'));
      if (networkFailure) { req.socket.destroy(); return; }
      const send = () => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(body); };
      if (delay) {
        const timer = setTimeout(() => { timers.delete(timer); send(); }, delay);
        timers.add(timer);
      } else send();
      return;
    }
    assert.equal(req.url, '/v2/users/offline-owner/messages');
    res.setHeader('Content-Type', 'application/json');
    if (JSON.parse(raw).event_id !== 'offline-outer-envelope') {
      res.statusCode = 400;
      res.end(JSON.stringify({ code: 40034025, message: 'event_id invalid' }));
      return;
    }
    res.end(JSON.stringify({ id: 'offline-reply' }));
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 60_000 } }));
    ws.on('message', (raw) => {
      const payload = JSON.parse(raw);
      if (![2, 6].includes(payload.op)) return;
      intents = payload.d.intents;
      const ready = { op: 0, s: 1, t: resume ? 'RESUMED' : 'READY',
        d: resume ? {} : { session_id: 'offline-session', user: { id: 'offline-user' } } };
      const callback = { op: 0, s: 2, t: 'INTERACTION_CREATE', id: 'offline-outer-envelope', d: event };
      for (const frame of beforeReady ? [callback, ready] : [ready, callback]) ws.send(JSON.stringify(frame));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let envelopes;
  const sdkLogger = { ...logger, info: () => envelopes?.attach() };
  const bot = new QQBot({ appId: 'offline-app', appSecret: 'offline-secret', baseUrl: origin, tokenBaseUrl: origin,
    logger: sdkLogger, ...(resume ? { sessionPersistence: { load: () => ({ sessionId: 'offline-session', lastSeq: 1 }),
      save() {}, clear() {} } } : {}) });
  const replyBot = createEventAwareBot(bot);
  envelopes = createQqInteractionEnvelopeTracker({ bot });
  bot.on('ready', () => envelopes.attach());
  bot.on('resumed', () => envelopes.attach());
  let accepted = 0;
  let context;
  let complete;
  const completed = new Promise((resolve) => { complete = resolve; });
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.sgroup.qq.com');
    assert.equal(parsed.pathname, '/interactions/offline-interaction');
    assert.equal(options.headers.Authorization, 'QQBot offline-access');
    assert.equal(options.redirect, 'error');
    return fetch(`${origin}${parsed.pathname}`, options);
  };
  const handler = createQqInteractionHandler({ bot, appId: 'offline-app', ownerUserOpenid: 'offline-owner',
    signal: actionController.signal, acknowledgementDeadlineMs: delay ? 100 : 2_500, logger,
    acknowledgeInteraction: (interactionId, code, options) => acknowledgeQqInteraction({ bot, interactionId, code, ...options, fetchImpl }),
    bridge: { validateMenuInteraction: () => ({ action: { kind: 'section', name: 'help' } }),
      accept: async (message) => { accepted++; await replyBot.sendText(message.replyTarget, 'offline action result'); } },
  });
  bot.on('interaction', async (ctx, value) => {
    context = { sameBot: ctx.bot === bot, sameEvent: ctx.event === value, milliseconds: Math.abs(Date.now() - ctx.receivedAt) < 1_000 };
    try { complete(await handler({ ...ctx, transportEventId: envelopes.replyEventIdFor(value) }, value)); }
    catch (error) { complete({ businessError: { httpStatus: error.httpStatus, bizCode: error.bizCode } }); }
  });
  const run = bot.start(connectionController.signal);
  t.after(async () => {
    connectionController.abort();
    envelopes.dispose();
    await run;
    for (const timer of timers) clearTimeout(timer);
    for (const client of wss.clients) client.terminate();
    server.closeAllConnections();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });
  let timeout;
  try {
    const result = await Promise.race([completed, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Offline SDK integration timed out')), 5_000);
    })]);
    return { result, calls, accepted, context, intents };
  } finally { clearTimeout(timeout); }
}

for (const resume of [false, true]) {
  test(`real SDK open-info envelope hook captures interaction before ${resume ? 'RESUMED replay finishes' : 'READY'}`, async (t) => {
    const f = await offlineGateway(t, { beforeReady: true, resume });
    assert.deepEqual(f.result, { code: 0, acknowledged: true });
    assert.equal(f.accepted, 1);
    assert.equal(f.calls[0].path, '/interactions/offline-interaction');
    assert.equal(f.calls[1].body.event_id, 'offline-outer-envelope');
  });
}

for (const [status, body] of [[204, ''], [200, ''], [200, '{}'], [200, '{"code":0}'], [200, '{"err_code":0}']]) {
  test(`real SDK gateway ACK HTTP ${status} ${body || 'empty'} runs business and delivers its event reply`, async (t) => {
    const f = await offlineGateway(t, { status, body });
    assert.equal(Boolean(f.intents & (1 << 26)), true);
    assert.deepEqual(f.context, { sameBot: true, sameEvent: true, milliseconds: true });
    assert.deepEqual(f.result, { code: 0, acknowledged: true });
    assert.equal(f.accepted, 1);
    assert.deepEqual(f.calls.map(({ method }) => method), ['PUT', 'POST']);
    assert.deepEqual(f.calls[0].body, { code: 0 });
    assert.equal(f.calls[0].path, '/interactions/offline-interaction');
    assert.equal(f.calls[1].body.event_id, 'offline-outer-envelope');
    assert.equal(f.calls[1].body.content, 'offline action result');
    assert.equal(Object.hasOwn(f.calls[1].body, 'msg_id'), false);
  });
}

for (const [status, body] of [[403, '{"code":630003}'], [500, '{}'], [200, '{"code":630008}'],
  [200, '{"err_code":630008}'], [200, '{"code":0,"err_code":630008}'], [200, '<html>bad gateway</html>'],
  [200, 'null'], [200, '[]'], [202, '{}'], [202, ''], [500, '']]) {
  test(`real SDK gateway ACK rejection HTTP ${status} ${body} never runs business or retries`, async (t) => {
    const f = await offlineGateway(t, { status, body });
    assert.deepEqual(f.result, { code: 0, acknowledged: false });
    assert.equal(f.accepted, 0);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].method, 'PUT');
  });
}

for (const options of [{ networkFailure: true }, { delay: 300 }, { abortOnAck: true }]) {
  test(`real SDK gateway ACK ${Object.keys(options)[0]} never runs business or retries`, async (t) => {
    const f = await offlineGateway(t, options);
    assert.deepEqual(f.result, { code: 0, acknowledged: false });
    assert.equal(f.accepted, 0);
    assert.equal(f.calls.length, 1);
  });
}

test('QQ ACK adapter encodes the event ID and only uses the fixed official origin', async () => {
  const calls = [];
  const bot = { api: { getToken: async () => 'offline-access' } };
  await acknowledgeQqInteraction({ bot, interactionId: 'offline/id?#%', code: 4,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response('{}'); } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.sgroup.qq.com/interactions/offline%2Fid%3F%23%25');
  assert.deepEqual(JSON.parse(calls[0].options.body), { code: 4 });
  assert.equal(calls[0].options.redirect, 'error');
});

test('QQ ACK token failure and pre-abort never dispatch HTTP or reveal the token error', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response('{}'); };
  await assert.rejects(acknowledgeQqInteraction({ interactionId: 'offline', fetchImpl,
    bot: { api: { getToken: async () => { throw new Error('private credential detail'); } } },
  }), (error) => !error.message.includes('private credential detail'));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(acknowledgeQqInteraction({ interactionId: 'offline', fetchImpl, signal: controller.signal,
    bot: { api: { getToken: async () => { calls++; return 'offline-access'; } } },
  }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('QQ ACK deadline covers SDK token acquisition and never dispatches after late token completion', async () => {
  let completeToken;
  let calls = 0;
  const token = new Promise((resolve) => { completeToken = resolve; });
  const task = acknowledgeQqInteraction({ bot: { api: { getToken: () => token } }, interactionId: 'offline', timeoutMs: 5,
    fetchImpl: async () => { calls++; return new Response('{}'); } });
  await assert.rejects(task, { code: 'qq-operation-timeout' });
  completeToken('offline-access');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
});
