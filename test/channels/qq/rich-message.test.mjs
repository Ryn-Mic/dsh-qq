import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, QQBot } from '@tencent-connect/qqbot-nodejs';
import { sendQqRichMessage, validateQqRichMessage } from '../../../src/channels/qq/qq-rich-message.mjs';
import { QqHarnessBridge } from '../../../src/channels/qq/qq-bridge.mjs';

const target = { scope: 'c2c', targetId: 'synthetic-user', msgId: 'synthetic-trigger' };
const keyboard = { content: { rows: [{ buttons: [{
  id: 'help', render_data: { label: '帮助', style: 1 },
  action: { type: 2, data: '/help', enter: false, permission: { type: 2 } },
}] }] } };

test('QQ rich text and Markdown preserve explicit types and keyboard through the real pinned SDK', async () => {
  const calls = [];
  const bot = new QQBot({ appId: 'synthetic-app', appSecret: 'synthetic-secret', markdownSupport: false });
  bot.tokenManager.getAccessToken = async () => 'synthetic-token';
  bot.apiClient.request = async (_token, method, path, body) => {
    calls.push({ method, path, body }); return { id: `synthetic-${calls.length}` };
  };
  await sendQqRichMessage(bot, target, { type: 'text', text: 'hello', keyboard });
  await sendQqRichMessage(bot, target, { type: 'markdown', text: '**hello**', keyboard });
  assert.equal(calls[0].path, '/v2/users/synthetic-user/messages');
  assert.equal(calls[0].body.msg_type, 0);
  assert.equal(calls[0].body.content, 'hello');
  assert.deepEqual(calls[0].body.keyboard, keyboard);
  assert.equal(calls[1].body.msg_type, 2);
  assert.deepEqual(calls[1].body.markdown, { content: '**hello**' });
  assert.equal('content' in calls[1].body, false);
  assert.equal(calls[1].body.msg_id, target.msgId);
});

test('QQ tuwen uses msg_type=8 with the documented card fields through the real SDK', async () => {
  let sent;
  const bot = new QQBot({ appId: 'synthetic-app', appSecret: 'synthetic-secret' });
  bot.tokenManager.getAccessToken = async () => 'synthetic-token';
  bot.apiClient.request = async (_token, _method, _path, body) => { sent = body; return { id: 'synthetic-card' }; };
  const payload = { type: 'tuwen', title: '结果', description: '已完成', url: 'https://example.com/result', pic_url: 'https://example.com/result.png' };
  await sendQqRichMessage(bot, target, payload);
  assert.equal(sent.msg_type, 8);
  assert.deepEqual(sent.card, { type: 'tuwen', content: { title: '结果', description: '已完成', url: payload.url, pic_url: payload.pic_url } });
  assert.equal('content' in sent, false);
});

for (const [type, fileType] of [['image', 1], ['video', 2], ['voice', 3], ['file', 4]]) {
  test(`QQ ${type} invokes native SDK upload type ${fileType} then media send`, async () => {
    const calls = [];
    const bot = new QQBot({ appId: 'synthetic-app', appSecret: 'synthetic-secret' });
    bot.tokenManager.getAccessToken = async () => 'synthetic-token';
    bot.apiClient.request = async (_token, method, path, body) => {
      calls.push({ method, path, body });
      return path.endsWith('/files') ? { file_info: `synthetic-${type}`, file_uuid: 'synthetic-uuid', ttl: 100 } : { id: 'synthetic-media' };
    };
    const result = await sendQqRichMessage(bot, { scope: 'group', targetId: 'synthetic-group' }, {
      type, source: { url: `https://example.com/sample.${type === 'voice' ? 'silk' : type === 'video' ? 'mp4' : type === 'image' ? 'png' : 'pdf'}` },
      ...(type === 'file' ? { fileName: '结果.pdf' } : {}),
    });
    assert.equal(calls[0].path, '/v2/groups/synthetic-group/files');
    assert.equal(calls[0].body.file_type, fileType);
    assert.equal(calls[0].body.srv_send_msg, false);
    assert.equal(calls[1].body.msg_type, 7);
    assert.equal(calls[1].body.media.file_info, `synthetic-${type}`);
    assert.equal(result.message.id, 'synthetic-media');
    if (type === 'file') assert.equal(calls[0].body.file_name, '结果.pdf');
  });
}

test('QQ rich message rejects invalid/untyped fields, counts, URLs and arbitrary local files before dispatch', async () => {
  let sends = 0;
  const bot = { send: async () => { sends += 1; } };
  const card = { type: 'tuwen', title: 't', description: 'd', url: 'https://example.com', pic_url: 'https://example.com/p.png' };
  for (const invalid of [
    { ...card, title: 'a'.repeat(51) }, { ...card, description: 'a'.repeat(201) },
    { ...card, url: 'http://example.com' }, { ...card, pic_url: 'data:image/png;base64,abc' },
    { type: 'markdown', text: 'hi', extra: { msg_type: 8 } },
    { type: 'text', text: 'hi', keyboard: { id: 'one', content: { rows: [] } } },
    { type: 'image', source: { localPath: '/etc/passwd' } },
    { type: 'file', source: { url: 'https://example.com/file' }, fileName: '../file' },
    { type: 'voice', source: { url: 'https://example.com/voice' }, caption: 'not supported' },
  ]) await assert.rejects(sendQqRichMessage(bot, target, invalid), TypeError);
  assert.equal(sends, 0);
  await assert.rejects(sendQqRichMessage(bot, { ...target, targetId: '../unexpected?route' }, { type: 'text', text: 'hello' }), /openid/u);
  const tooMany = { type: 'markdown', text: 'hi', keyboard: { content: { rows: Array(6).fill(keyboard.content.rows[0]) } } };
  assert.throws(() => validateQqRichMessage(tooMany), /1-5/u);
});

test('QQ rich media converts validated base64 to SDK buffer and rejects empty/multiple sources', async () => {
  let source;
  await sendQqRichMessage({ sendVoice: async (_target, value) => { source = value; return { id: 'voice' }; } }, target,
    { type: 'voice', source: { base64: Buffer.from('synthetic-media-bytes').toString('base64') } });
  assert.equal(source.buffer.toString(), 'synthetic-media-bytes');
  for (const invalid of [{ buffer: Buffer.alloc(0) }, { base64: 'invalid!' }, { url: 'https://example.com', buffer: Buffer.from('x') }]) {
    assert.throws(() => validateQqRichMessage({ type: 'file', source: invalid }), TypeError);
  }
});

test('QQ rich delivery timeout and network failures never trigger a downgrade or duplicate SDK call', async () => {
  const calls = [];
  const bot = {
    sendVideo: async () => { calls.push('video'); return new Promise(() => {}); },
    sendFile: async () => calls.push('file'), sendText: async () => calls.push('text'),
  };
  await assert.rejects(sendQqRichMessage(bot, target, { type: 'video', source: { url: 'https://example.com/video.mp4' } }, { timeoutMs: 10 }), { code: 'qq-delivery-uncertain' });
  assert.deepEqual(calls, ['video']);
  await assert.rejects(sendQqRichMessage({ send: async () => { throw new ApiError('denied', 403, '/messages'); } }, target,
    { type: 'text', text: 'hello' }), { code: 'qq-message-rejected', httpStatus: 403 });
});

test('QQ bridge exposes a reachable rich-message path and respects pre-dispatch cancellation', async () => {
  const calls = [];
  const bridge = new QqHarnessBridge({
    bot: { sendText: async () => {}, sendVideo: async (...args) => { calls.push(args); return { message: { id: 'synthetic-video' } }; } },
    ownerUserOpenid: '*', harness: {}, state: { hasSeen: () => false },
  });
  await bridge.sendRich(target, { type: 'video', source: { url: 'https://example.com/video.mp4' }, caption: '结果' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].targetId, target.targetId);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(bridge.sendRich(target, { type: 'video', source: { url: 'https://example.com/video.mp4' } }, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls.length, 1);
});
