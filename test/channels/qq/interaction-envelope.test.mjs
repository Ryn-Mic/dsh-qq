import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createQqInteractionEnvelopeTracker } from '../../../src/channels/qq/interaction-envelope.mjs';

function fixture(options = {}) {
  const socket = new EventEmitter();
  const bot = { gateway: { currentWs: socket } };
  let time = 100;
  const tracker = createQqInteractionEnvelopeTracker({ bot, now: () => time, ...options });
  const event = (changes = {}) => ({ id: 'inner', type: 11, application_id: 'app', scene: 'c2c', chat_type: 2,
    user_openid: 'owner', version: 1, timestamp: '2026-11-03T00:00:00Z', data: { type: 11,
      resolved: { button_data: '/m pick 0123456789abcdef01234567 1', button_id: '0123456789abcdef01234567_1' } }, ...changes });
  const frame = (value = event(), id = 'outer-with-a-different-value') => JSON.stringify({ op: 0, t: 'INTERACTION_CREATE', id, d: value });
  return { socket, bot, tracker, event, frame, advance: (ms) => { time += ms; } };
}

test('QQ envelope tracker runs before the existing SDK listener and never changes frames or event IDs', () => {
  const f = fixture();
  let observed;
  f.socket.on('message', (raw) => { observed = f.tracker.replyEventIdFor(JSON.parse(raw).d); });
  assert.equal(f.tracker.attach(), true);
  assert.equal(f.tracker.attach(), true);
  assert.equal(f.socket.listenerCount('message'), 2);
  const raw = f.frame();
  f.socket.emit('message', raw);
  assert.equal(observed, 'outer-with-a-different-value');
  assert.equal(f.tracker.replyEventIdFor(f.event()), 'outer-with-a-different-value');
  assert.equal(JSON.parse(raw).d.id, 'inner');
});

test('QQ envelope tracker decodes the SDK-supported frame formats', () => {
  for (const encode of [(s) => s, (s) => Buffer.from(s), (s) => [Buffer.from(s.slice(0, 20)), Buffer.from(s.slice(20))],
    (s) => Uint8Array.from(Buffer.from(s)), (s) => Uint8Array.from(Buffer.from(s)).buffer]) {
    const f = fixture();
    f.tracker.attach();
    f.socket.emit('message', encode(f.frame()));
    assert.equal(f.tracker.replyEventIdFor(f.event()), 'outer-with-a-different-value');
  }
});

test('QQ envelope metadata is bound to all platform identity and button fields', () => {
  const f = fixture();
  f.tracker.attach();
  f.socket.emit('message', f.frame());
  for (const changes of [{ id: 'another' }, { application_id: 'different' }, { type: 12 }, { scene: 'group' },
    { chat_type: 1 }, { user_openid: 'other' }, { group_openid: 'other' }, { group_member_openid: 'other' },
    { guild_id: 'other' }, { channel_id: 'other' }, { version: 2 }, { timestamp: 'different' },
    { data: { ...f.event().data, type: 12 } },
    { data: { type: 11, resolved: { ...f.event().data.resolved, button_data: 'different' } } },
    { data: { type: 11, resolved: { ...f.event().data.resolved, button_id: 'different' } } }]) {
    assert.equal(f.tracker.replyEventIdFor(f.event(changes)), undefined);
  }
});

test('QQ conflicting frames with the same inner ID cannot poison an actor binding', () => {
  const f = fixture();
  f.tracker.attach();
  f.socket.emit('message', f.frame());
  const changed = f.event({ user_openid: 'different-actor' });
  f.socket.emit('message', f.frame(changed, 'different-outer'));
  assert.equal(f.tracker.replyEventIdFor(f.event()), undefined);
  assert.equal(f.tracker.replyEventIdFor(changed), undefined);
  f.socket.emit('message', f.frame());
  assert.equal(f.tracker.replyEventIdFor(f.event()), undefined);
});

test('QQ envelope tracker ignores unrelated, missing and malformed outer metadata', () => {
  const f = fixture();
  f.tracker.attach();
  for (const raw of ['invalid json', '{}', JSON.stringify({ op: 1, t: 'INTERACTION_CREATE', id: 'outer', d: f.event() }),
    JSON.stringify({ op: 0, t: 'C2C_MESSAGE_CREATE', id: 'outer', d: f.event() }),
    JSON.stringify({ op: 0, t: 'INTERACTION_CREATE', d: f.event() }),
    JSON.stringify({ op: 0, t: 'INTERACTION_CREATE', id: '', d: f.event() }),
    JSON.stringify({ op: 0, t: 'INTERACTION_CREATE', id: 'outer', d: { ...f.event(), user_openid: {} } })]) {
    assert.doesNotThrow(() => f.socket.emit('message', raw));
    assert.equal(f.tracker.replyEventIdFor(f.event()), undefined);
  }
});

test('QQ envelope tracker expires entries without extending TTL on duplicate delivery and caps its cache', () => {
  const f = fixture({ ttlMs: 10, maxEntries: 2 });
  f.tracker.attach();
  f.socket.emit('message', f.frame());
  f.advance(9);
  f.socket.emit('message', f.frame());
  assert.equal(f.tracker.replyEventIdFor(f.event()), 'outer-with-a-different-value');
  f.advance(1);
  assert.equal(f.tracker.replyEventIdFor(f.event()), undefined);
  for (const id of ['one', 'two', 'three']) f.socket.emit('message', f.frame(f.event({ id }), `outer-${id}`));
  assert.equal(f.tracker.replyEventIdFor(f.event({ id: 'one' })), undefined);
  assert.equal(f.tracker.replyEventIdFor(f.event({ id: 'two' })), 'outer-two');
  assert.equal(f.tracker.replyEventIdFor(f.event({ id: 'three' })), 'outer-three');
});

test('QQ envelope tracker replaces socket listeners on reconnect and disposes all state', () => {
  const f = fixture();
  f.tracker.attach();
  f.socket.emit('message', f.frame());
  const replacement = new EventEmitter();
  const oldListener = f.socket.listeners('message')[0];
  f.bot.gateway.currentWs = replacement;
  f.socket.emit('message', f.frame(f.event({ id: 'stale-socket' })));
  assert.equal(f.tracker.replyEventIdFor(f.event({ id: 'stale-socket' })), undefined);
  assert.equal(f.tracker.attach(), true);
  assert.equal(f.socket.listenerCount('message'), 0);
  assert.equal(replacement.listenerCount('message'), 1);
  oldListener(f.frame(f.event({ id: 'retained-stale-callback' })));
  assert.equal(f.tracker.replyEventIdFor(f.event({ id: 'retained-stale-callback' })), undefined);
  f.tracker.dispose();
  assert.equal(replacement.listenerCount('message'), 0);
  assert.equal(f.tracker.replyEventIdFor(f.event()), undefined);
  assert.equal(f.tracker.attach(), false);
  f.tracker.dispose();
  assert.equal(createQqInteractionEnvelopeTracker({ bot: {} }).attach(), false);
});
