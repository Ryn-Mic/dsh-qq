import { ApiError } from '@tencent-connect/qqbot-nodejs';
import {
  nativeMenuDiff, validateNativeMenu, validatePanelCreate, validatePanelId,
  validatePanelList, validatePanelTargets, validatePanelUpdate,
} from './native-menu.mjs';
import { isDefinitiveQqRejection, qqInteger, withQqOperation } from './qq-validation.mjs';

const QQ_API_ORIGIN = 'https://api.sgroup.qq.com';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/**
 * QQ menu/panel REST extension using the running SDK's supported getToken().
 * It owns no credentials, token cache, Gateway connection or retry loop. The
 * official origin is fixed so management input cannot redirect its identity.
 */
export class QqExtendedApi {
  #bot;
  #fetch;
  #timeoutMs;

  constructor({ bot, fetchImpl = fetch, timeoutMs = 30_000 } = {}) {
    if (typeof bot?.api?.getToken !== 'function') throw new TypeError('QQ SDK api.getToken() is required');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
    qqInteger(timeoutMs, 'timeoutMs', 1, 120_000);
    this.#bot = bot;
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  async #request(method, path, body, { signal, timeoutMs = this.#timeoutMs } = {}) {
    let dispatched = false;
    try {
      return await withQqOperation(async (operationSignal) => {
        let token;
        try { token = await this.#bot.api.getToken(); } catch {
          const error = new Error('Unable to acquire the running QQ SDK access token');
          error.code = 'qq-token-unavailable';
          throw error;
        }
        operationSignal.throwIfAborted();
        if (typeof token !== 'string' || !token || /[\r\n]/u.test(token)) {
          throw new TypeError('QQ SDK returned an invalid access token');
        }
        let response;
        try {
          const request = {
            method, signal: operationSignal, redirect: 'error',
            headers: { Authorization: `QQBot ${token}`, 'Content-Type': 'application/json' },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          };
          dispatched = true;
          response = await this.#fetch(`${QQ_API_ORIGIN}${path}`, request);
        } catch {
          if (operationSignal.aborted) throw operationSignal.reason;
          const error = new Error(`QQ ${method} request failed; no automatic retry was attempted`);
          error.code = method === 'GET' ? 'qq-api-unavailable' : 'qq-management-outcome-unknown';
          throw error;
        }
        const raw = await response.text();
        if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) throw new Error('QQ response exceeded the maximum size');
        let data;
        try { data = raw ? JSON.parse(raw) : {}; } catch {
          const error = new Error('QQ returned an invalid JSON response');
          error.code = method === 'GET' ? 'qq-api-invalid-response' : 'qq-management-outcome-unknown';
          throw error;
        }
        if (!response.ok) {
          // Do not forward arbitrary upstream response text into logs or the UI.
          throw new ApiError(`QQ management API rejected ${method} ${path.split('?')[0]} (HTTP ${response.status})`,
            response.status, path, Number.isFinite(Number(data?.code ?? data?.err_code))
              ? Number(data.code ?? data.err_code) : undefined);
        }
        return data;
      }, { signal, timeoutMs });
    } catch (cause) {
      if (method === 'GET' || !dispatched || isDefinitiveQqRejection(cause)
        || cause?.code === 'qq-management-outcome-unknown') throw cause;
      // Abort/timeout only stops waiting. Once fetch has received a mutation,
      // the server may have applied it even if no response can be confirmed.
      const error = new Error('QQ management write outcome is unknown; query the current configuration before retrying', { cause });
      error.code = 'qq-management-outcome-unknown';
      if (cause?.httpStatus !== undefined) error.httpStatus = cause.httpStatus;
      if (cause?.bizCode !== undefined) error.bizCode = cause.bizCode;
      throw error;
    }
  }

  getMenu(options) { return this.#request('GET', '/v2/menu', undefined, options); }

  async previewMenu(body, options) {
    validateNativeMenu(body);
    return nativeMenuDiff(await this.getMenu(options), body);
  }

  async putMenu(body, { expectedVersion, ...options } = {}) {
    const desired = validateNativeMenu(body);
    if (expectedVersion !== undefined) qqInteger(expectedVersion, 'expectedVersion', 0, Number.MAX_SAFE_INTEGER);
    const before = await this.getMenu(options);
    if (expectedVersion !== undefined && before.version !== expectedVersion) {
      const error = new Error('QQ menu changed since it was reviewed; refresh the preview before applying');
      error.code = 'qq-menu-version-conflict';
      throw error;
    }
    const diff = nativeMenuDiff(before, desired);
    if (!diff.changed) return { ...diff, after: structuredClone(before) };
    let result;
    try { result = await this.#request('PUT', '/v2/menu', desired, options); } catch (error) {
      error.menuBackup = diff.before;
      error.menuRestore = diff.restore;
      throw error;
    }
    // Reread after a write. If it cannot be confirmed, retain the exact backup
    // and never blindly restore (that could overwrite another administrator).
    try {
      return { ...diff, result, after: await this.getMenu(options) };
    } catch (cause) {
      const error = new Error('QQ accepted the menu write, but the resulting menu could not be read', { cause });
      error.code = 'qq-management-outcome-unknown';
      error.menuBackup = diff.before;
      error.menuRestore = diff.restore;
      throw error;
    }
  }

  listPanels(query, options) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(validatePanelList(query))) params.set(key, String(value));
    return this.#request('GET', `/v2/panels?${params}`, undefined, options);
  }

  getPanel(panelId, options) {
    return this.#request('GET', `/v2/panels/${encodeURIComponent(validatePanelId(panelId))}`, undefined, options);
  }

  createPanel(body, options) {
    return this.#request('POST', '/v2/panels', validatePanelCreate(body), options);
  }

  updatePanel(panelId, body, options) {
    return this.#request('PUT', `/v2/panels/${encodeURIComponent(validatePanelId(panelId))}`,
      validatePanelUpdate(body), options);
  }

  deletePanel(panelId, options) {
    return this.#request('DELETE', `/v2/panels/${encodeURIComponent(validatePanelId(panelId))}`, undefined, options);
  }

  async updatePanelTargets(panelId, body, options) {
    validatePanelId(panelId);
    const desired = validatePanelTargets(body);
    const current = await this.getPanel(panelId, options);
    const key = current.scope === 'c2c' ? 'user_openids' : current.scope === 'group' ? 'group_openids' : null;
    if (current.target_type !== 'specific' || !key || !(key in desired)) {
      throw new TypeError('Panel target changes must match a specific C2C/group panel and its scope');
    }
    return this.#request('PUT', `/v2/panels/${encodeURIComponent(panelId)}/target`, desired, options);
  }
}

export const createQqExtendedApi = (options) => new QqExtendedApi(options);
