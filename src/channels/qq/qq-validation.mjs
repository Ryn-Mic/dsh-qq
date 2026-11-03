/** Small, shared validation and cancellation helpers for QQ-only features. */
export function qqObject(value, allowed, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${path} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${path}.${key} is not supported`);
  }
  return value;
}

// QQ menus/panels count a Chinese character as two, unlike JS string.length.
// Counting all non-ASCII characters as two is conservative for emoji as well.
export function qqCharacterWidth(value) {
  return [...value].reduce((count, character) => count + (character.codePointAt(0) > 0x7f ? 2 : 1), 0);
}

export function qqString(value, path, { max = 4096, min = 1, wide = false } = {}) {
  if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${path} must be a string without control characters`);
  }
  const length = wide ? qqCharacterWidth(value) : [...value].length;
  if (length < min || length > max || (min > 0 && !value.trim())) {
    throw new TypeError(`${path} must contain ${min}-${max} ${wide ? 'QQ characters' : 'characters'}`);
  }
  return value;
}

export function qqHttpsUrl(value, path, max = 1024) {
  qqString(value, path, { max });
  let parsed;
  try { parsed = new URL(value); } catch { throw new TypeError(`${path} must be an HTTPS URL`); }
  if (!value.startsWith('https://') || parsed.protocol !== 'https:' || parsed.username || parsed.password
    || /\s/u.test(value)) throw new TypeError(`${path} must be an HTTPS URL without credentials`);
  return value;
}

export function qqArray(value, path, max, min = 0) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new TypeError(`${path} must contain ${min}-${max} items`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new TypeError(`${path} must not contain missing entries`);
  }
  return value;
}

export function qqEnum(value, values, path) {
  if (!values.includes(value)) throw new TypeError(`${path} must be one of ${values.join(', ')}`);
  return value;
}

export function qqBoolean(value, path) {
  if (typeof value !== 'boolean') throw new TypeError(`${path} must be a boolean`);
  return value;
}

export function qqInteger(value, path, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${path} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function qqAbortReason(signal) {
  return signal?.reason instanceof Error ? signal.reason : new DOMException('Operation aborted', 'AbortError');
}

/**
 * SDK send methods do not accept AbortSignal in 1.0.4. Bound the caller's wait,
 * observe late rejection, and never retry a send whose result is unknown.
 * REST calls also receive this signal so their underlying fetch is cancelled.
 */
export async function withQqOperation(operation, { signal, timeoutMs = 30_000 } = {}) {
  qqInteger(timeoutMs, 'timeoutMs', 1, 120_000);
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(qqAbortReason(signal));
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    const error = new Error('QQ operation timed out; its delivery outcome may be unknown');
    error.name = 'TimeoutError';
    error.code = 'qq-operation-timeout';
    controller.abort(error);
  }, timeoutMs);
  let onAbort;
  try {
    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(qqAbortReason(controller.signal));
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    return await Promise.race([Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return operation(controller.signal);
    }), cancelled]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', onAbort);
  }
}

export function isDefinitiveQqRejection(error) {
  const status = Number(error?.httpStatus ?? error?.status);
  return status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}
