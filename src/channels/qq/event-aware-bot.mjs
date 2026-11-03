const eventIdFor = (target) => typeof target?.eventId === 'string' ? target.eventId.trim() : '';

/**
 * SDK 1.0.4 sendText() treats every target without msgId as a proactive push.
 * INTERACTION_CREATE instead authorizes a passive reply through event_id.
 * Keep that adaptation local to this runtime; other SDK calls stay bound to
 * the real instance, including getters and methods that use private fields.
 */
export function createEventAwareBot(bot) {
  const bound = new Map();
  const sequences = new Map();
  const send = (request) => {
    const eventId = eventIdFor(request?.target);
    if (!eventId) return bot.send(request);
    const { eventId: _eventId, msgId: _msgId, ...target } = request.target;
    const { msg_id: _passiveMessageId, ...extra } = request.extra ?? {};
    const msgSeq = extra.msg_seq ?? (sequences.get(eventId) ?? 0) + 1;
    sequences.set(eventId, Math.max(sequences.get(eventId) ?? 0, msgSeq));
    return bot.send({ ...request, target, extra: { ...extra, event_id: eventId, msg_seq: msgSeq } });
  };
  const overrides = {
    send,
    sendText: (target, content) => eventIdFor(target)
      ? send({ target, msgType: 0, content }) : bot.sendText(target, content),
    sendMarkdown: (target, content, options) => eventIdFor(target)
      ? send({ target, msgType: 2, markdown: { content }, keyboard: options?.keyboard })
      : bot.sendMarkdown(target, content, options),
    sendTextWithKeyboard: (target, content, keyboard) => eventIdFor(target)
      ? send({ target, msgType: 0, content, keyboard })
      : bot.sendTextWithKeyboard(target, content, keyboard),
  };
  return new Proxy(bot, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (Object.hasOwn(overrides, property) && typeof value === 'function') return overrides[property];
      if (typeof value !== 'function') return value;
      if (!bound.has(property)) bound.set(property, value.bind(target));
      return bound.get(property);
    },
  });
}
