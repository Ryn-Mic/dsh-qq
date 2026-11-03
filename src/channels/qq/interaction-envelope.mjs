import { decodeGatewayMessageData } from '@tencent-connect/qqbot-nodejs/protocol';
import { qqInteger } from './qq-validation.mjs';

const identifier = (value) => typeof value === 'string' && value.trim() && value.length <= 4096 ? value : undefined;

function fingerprint(event) {
  if (!identifier(event?.id)) return undefined;
  const fields = [event.id, event.application_id, event.type, event.scene, event.chat_type, event.version,
    event.user_openid, event.group_openid, event.group_member_openid, event.guild_id, event.channel_id,
    event.timestamp, event.data?.type, event.data?.resolved?.button_data, event.data?.resolved?.button_id];
  if (fields.some((value) => value !== undefined && !(typeof value === 'string' && value.length <= 4096)
    && !Number.isSafeInteger(value))) return undefined;
  return JSON.stringify(fields);
}

/**
 * SDK 1.0.4 drops the outer gateway ID. Observe its existing socket before the
 * SDK listener parses the frame, retaining only identity-bound reply metadata.
 * This pinned compatibility boundary owns no connection and never edits data.
 */
export function createQqInteractionEnvelopeTracker({ bot, now = Date.now, ttlMs = 300_000, maxEntries = 512 } = {}) {
  qqInteger(ttlMs, 'ttlMs', 1, 1_800_000);
  qqInteger(maxEntries, 'maxEntries', 1, 65_536);
  const entries = new Map();
  let socket;
  let listener;
  let disposed = false;
  const prune = () => {
    const time = now();
    for (const [id, entry] of entries) if (entry.expiresAt <= time) entries.delete(id);
  };
  const observe = (data, source) => {
    if (disposed || source !== socket || source !== bot?.gateway?.currentWs) return;
    try {
      const frame = JSON.parse(decodeGatewayMessageData(data));
      if (frame?.op !== 0 || frame.t !== 'INTERACTION_CREATE' || !identifier(frame.id)) return;
      const identity = fingerprint(frame.d);
      if (!identity) return;
      prune();
      const id = frame.d.id;
      const existing = entries.get(id);
      if (existing) {
        // Conflicting envelopes cannot replace a prior actor/route binding.
        if (existing.identity !== identity || existing.outerId !== frame.id) {
          entries.set(id, { expiresAt: existing.expiresAt });
        }
        return;
      }
      entries.set(id, { identity, outerId: frame.id, expiresAt: now() + ttlMs });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    } catch {
      // Malformed/unsupported frames remain the SDK's responsibility. Never
      // log raw frames, IDs, actor identifiers or callback data here.
    }
  };
  const detach = () => {
    if (listener) socket?.removeListener('message', listener);
    socket = undefined;
    listener = undefined;
  };
  return Object.freeze({
    attach() {
      if (disposed) return false;
      const current = bot?.gateway?.currentWs;
      if (current === socket && socket) return true;
      detach();
      if (typeof current?.prependListener !== 'function' || typeof current?.removeListener !== 'function') return false;
      socket = current;
      listener = (data) => observe(data, current);
      socket.prependListener('message', listener);
      return true;
    },
    replyEventIdFor(event) {
      if (disposed) return undefined;
      prune();
      const entry = entries.get(event?.id);
      return entry?.identity && entry.identity === fingerprint(event) ? entry.outerId : undefined;
    },
    dispose() {
      disposed = true;
      detach();
      entries.clear();
    },
  });
}
