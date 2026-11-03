import { ApiError } from '@tencent-connect/qqbot-nodejs';
import { qqInteger, qqString, withQqOperation } from './qq-validation.mjs';

const QQ_API_ORIGIN = 'https://api.sgroup.qq.com';
const ACK_PATH = '/interactions/:id';
const MAX_RESPONSE_BYTES = 64 * 1024;

function responseError(message, response, data) {
  const value = data?.code ?? data?.err_code;
  return new ApiError(message, response.status, ACK_PATH, Number.isSafeInteger(value) ? value : undefined);
}

/** ACK-only compatibility for SDK 1.0.4's JSON parser rejecting empty success responses. */
export async function acknowledgeQqInteraction({
  bot, interactionId, code = 0, signal, timeoutMs = 2_500, fetchImpl = fetch,
} = {}) {
  if (typeof bot?.api?.getToken !== 'function') throw new TypeError('QQ SDK api.getToken() is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  qqString(interactionId, 'interactionId', { max: 1024 });
  qqInteger(code, 'code', 0, 5);
  return withQqOperation(async (operationSignal) => {
    let token;
    try { token = await bot.api.getToken(); } catch {
      throw new Error('Unable to acquire the running QQ SDK access token');
    }
    operationSignal.throwIfAborted();
    if (typeof token !== 'string' || !token || /[\r\n]/u.test(token)) {
      throw new TypeError('QQ SDK returned an invalid access token');
    }
    let response;
    try {
      response = await fetchImpl(`${QQ_API_ORIGIN}/interactions/${encodeURIComponent(interactionId)}`, {
        method: 'PUT', signal: operationSignal, redirect: 'error',
        headers: { Authorization: `QQBot ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
    } catch {
      if (operationSignal.aborted) throw operationSignal.reason;
      throw new Error('QQ interaction acknowledgement request failed; no retry was attempted');
    }
    let raw;
    try { raw = await response.text(); } catch {
      if (operationSignal.aborted) throw operationSignal.reason;
      throw responseError('Unable to read QQ interaction acknowledgement response', response);
    }
    operationSignal.throwIfAborted();
    if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) {
      throw responseError('QQ interaction acknowledgement response exceeded the maximum size', response);
    }
    let data;
    const text = raw.trim();
    if (text) {
      try { data = JSON.parse(text); } catch {
        throw responseError('QQ returned an invalid interaction acknowledgement response', response);
      }
    }
    if (![200, 204].includes(response.status)) {
      throw responseError('QQ rejected the interaction acknowledgement', response, data);
    }
    // This endpoint documents no response. QQ may send HTTP 204 or an empty
    // HTTP 200 instead of {}, which the SDK's generic JSON client rejects.
    if (!text) return;
    if (!data || typeof data !== 'object' || Array.isArray(data)
      || ['code', 'err_code'].some((key) => Object.hasOwn(data, key) && data[key] !== 0)) {
      throw responseError('QQ returned an unsuccessful interaction acknowledgement response', response, data);
    }
  }, { signal, timeoutMs });
}
