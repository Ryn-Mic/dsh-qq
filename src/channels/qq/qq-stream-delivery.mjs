import { isDefinitiveQqRejection, withQqOperation } from './qq-validation.mjs';

function uncertainStreamError(cause) {
  const error = new Error('QQ streamed delivery could not be confirmed; check the chat before retrying', { cause });
  error.code = 'qq-delivery-uncertain';
  return error;
}

/** Longest already-visible suffix matching the next snapshot's prefix. */
function suffixPrefixOverlap(previous, next) {
  const prefix = new Uint32Array(next.length);
  for (let index = 1, matched = 0; index < next.length; index += 1) {
    while (matched > 0 && next[index] !== next[matched]) matched = prefix[matched - 1];
    if (next[index] === next[matched]) matched += 1;
    prefix[index] = matched;
  }
  let matched = 0;
  for (let index = Math.max(0, previous.length - next.length); index < previous.length; index += 1) {
    while (matched > 0 && previous[index] !== next[matched]) matched = prefix[matched - 1];
    if (previous[index] === next[matched]) matched += 1;
    if (matched === next.length && index < previous.length - 1) matched = prefix[matched - 1];
  }
  return matched;
}

/** Opt-in adapter around the pinned SDK's C2C-only StreamSession. */
export class QqReplyStream {
  #stream;
  #signal;
  #timeoutMs;
  #logger;
  #failure = null;
  #tail = Promise.resolve();
  #cancelled = false;
  #wireText = '';

  constructor(stream, { signal, timeoutMs = 30_000, logger } = {}) {
    this.#stream = stream;
    this.#signal = signal;
    this.#timeoutMs = timeoutMs;
    this.#logger = logger;
  }

  updateProgress(text) {
    if (typeof text !== 'string' || !text || this.#cancelled || this.#failure) return this.#tail;
    this.#tail = this.#tail.then(async () => {
      if (this.#cancelled || this.#failure) return;
      try {
        const fullText = this.#appendSnapshot(text);
        await this.#operation(() => this.#stream.update(fullText));
      } catch (error) {
        this.#failure = error;
        this.cancel();
        this.#logger?.warn?.('[dsh-im:qq] live stream stopped; final delivery will assess whether fallback is safe');
      }
    });
    return this.#tail;
  }

  #operation(operation) {
    return withQqOperation(operation, { signal: this.#signal, timeoutMs: this.#timeoutMs });
  }

  #appendSnapshot(text) {
    if (typeof text !== 'string' || !text) return this.#wireText;
    if (text.startsWith(this.#wireText)) this.#wireText = text;
    else if (!this.#wireText.endsWith(text)) {
      const overlap = suffixPrefixOverlap(this.#wireText, text);
      this.#wireText += overlap > 0 ? text.slice(overlap) : `\n\n${text}`;
    }
    // Harness progress contains earlier tool preambles; finalAnswerOnly and
    // canonical messages may remove/rewrite them. QQ replace frames cannot
    // change any sent prefix, including a frame still queued by SDK throttle.
    // Retain that prefix and append revised/final text instead of deleting it.
    return this.#wireText;
  }

  async finish(text) {
    await this.#tail;
    this.#signal?.throwIfAborted();
    if (this.#failure) {
      if (isDefinitiveQqRejection(this.#failure)) return { fallback: true, reason: 'progress-rejected' };
      throw uncertainStreamError(this.#failure);
    }
    if (this.#cancelled) throw uncertainStreamError(new Error('Stream was cancelled'));
    try {
      const fullText = this.#appendSnapshot(text);
      await this.#operation(() => this.#stream.update(fullText));
    } catch (error) {
      this.cancel();
      if (isDefinitiveQqRejection(error)) return { fallback: true, reason: 'final-rejected' };
      throw uncertainStreamError(error);
    }
    // update() may already have sent the final answer or queued it behind the
    // SDK throttle. A failed DONE must never resend a second Markdown answer.
    try {
      const response = await this.#operation(() => this.#stream.complete());
      return { fallback: false, response };
    } catch (error) {
      this.cancel();
      throw uncertainStreamError(error);
    }
  }

  cancel() {
    this.#cancelled = true;
    try { this.#stream.cancel?.(); } catch { /* cancellation is best effort */ }
  }
}

export async function openQqReplyStream(bot, target, { enabled = false, signal, timeoutMs = 30_000, logger } = {}) {
  if (!enabled || target?.scope !== 'c2c' || !target.msgId || target.eventId || typeof bot?.openStream !== 'function') return null;
  try {
    const stream = await withQqOperation(() => bot.openStream({ target }), { signal, timeoutMs });
    if (typeof stream?.update !== 'function' || typeof stream?.complete !== 'function') {
      throw new TypeError('QQ SDK returned an invalid stream session');
    }
    return new QqReplyStream(stream, { signal, timeoutMs, logger });
  } catch (error) {
    if (signal?.aborted) throw error;
    // Creating the SDK session does not dispatch any message.
    logger?.warn?.('[dsh-im:qq] unable to open live stream; using final Markdown delivery');
    return null;
  }
}
