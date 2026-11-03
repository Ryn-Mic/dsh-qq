import {
  isDefinitiveQqRejection, qqArray, qqBoolean, qqEnum, qqHttpsUrl, qqInteger,
  qqObject, qqString, withQqOperation,
} from './qq-validation.mjs';

const MAX_MEDIA_BYTES = 200 * 1024 * 1024;
const MEDIA_METHODS = Object.freeze({ image: 'sendImage', file: 'sendFile', voice: 'sendVoice', video: 'sendVideo' });

export function validateQqReplyTarget(value) {
  qqObject(value, ['scope', 'targetId', 'msgId'], 'target');
  qqEnum(value.scope, ['c2c', 'group'], 'target.scope');
  qqString(value.targetId, 'target.targetId', { max: 256 });
  if (!/^[A-Za-z0-9_-]+$/u.test(value.targetId)) throw new TypeError('target.targetId must be a QQ openid');
  if (value.msgId !== undefined) qqString(value.msgId, 'target.msgId', { max: 1024 });
  return structuredClone(value);
}

function validateKeyboard(value) {
  qqObject(value, ['id', 'content'], 'keyboard');
  if (('id' in value) === ('content' in value)) throw new TypeError('keyboard requires exactly one of id/content');
  if ('id' in value) { qqString(value.id, 'keyboard.id', { max: 128 }); return; }
  qqObject(value.content, ['rows'], 'keyboard.content');
  const ids = new Set();
  qqArray(value.content.rows, 'keyboard.content.rows', 5, 1).forEach((row, rowIndex) => {
    const rowPath = `keyboard.content.rows[${rowIndex}]`;
    qqObject(row, ['buttons'], rowPath);
    qqArray(row.buttons, `${rowPath}.buttons`, 5, 1).forEach((button, buttonIndex) => {
      const path = `${rowPath}.buttons[${buttonIndex}]`;
      qqObject(button, ['id', 'render_data', 'action', 'group_id'], path);
      if (button.id !== undefined) {
        qqString(button.id, `${path}.id`, { max: 128 });
        if (ids.has(button.id)) throw new TypeError('keyboard button IDs must be unique');
        ids.add(button.id);
      }
      qqObject(button.render_data, ['label', 'visited_label', 'style'], `${path}.render_data`);
      qqString(button.render_data.label, `${path}.render_data.label`, { max: 10 });
      if (button.render_data.visited_label !== undefined) qqString(button.render_data.visited_label, `${path}.render_data.visited_label`, { max: 10 });
      if (button.render_data.style !== undefined) qqEnum(button.render_data.style, [0, 1, 3, 4], `${path}.render_data.style`);
      const action = qqObject(button.action, ['type', 'permission', 'data', 'enter', 'reply', 'anchor', 'unsupport_tips', 'modal'], `${path}.action`);
      qqEnum(action.type, [0, 1, 2], `${path}.action.type`);
      qqString(action.data, `${path}.action.data`, { max: 4096 });
      if (action.type === 0) qqHttpsUrl(action.data, `${path}.action.data`);
      for (const key of ['enter', 'reply']) {
        if (action[key] !== undefined) {
          if (action.type !== 2) throw new TypeError(`${path}.action.${key} requires a command button`);
          qqBoolean(action[key], `${path}.action.${key}`);
        }
      }
      if (action.anchor !== undefined) {
        if (action.type !== 2) throw new TypeError(`${path}.action.anchor requires a command button`);
        qqEnum(action.anchor, [1], `${path}.action.anchor`);
      }
      if (action.unsupport_tips !== undefined) qqString(action.unsupport_tips, `${path}.action.unsupport_tips`, { max: 200 });
      if (button.group_id !== undefined) {
        if (action.type !== 1) throw new TypeError(`${path}.group_id requires a callback button`);
        qqString(button.group_id, `${path}.group_id`, { max: 128 });
      }
      if (action.permission !== undefined) {
        const permission = qqObject(action.permission, ['type', 'specify_user_ids'], `${path}.action.permission`);
        qqEnum(permission.type, [0, 1, 2], `${path}.action.permission.type`);
        if (permission.type === 0) qqArray(permission.specify_user_ids, `${path}.action.permission.specify_user_ids`, 100, 1)
          .forEach((id) => qqString(id, `${path}.action.permission.user`, { max: 256 }));
        else if ('specify_user_ids' in permission) throw new TypeError('specify_user_ids requires permission.type=0');
      }
      if (action.modal !== undefined) {
        const modal = qqObject(action.modal, ['content', 'confirm_text', 'cancel_text'], `${path}.action.modal`);
        qqString(modal.content, `${path}.action.modal.content`, { max: 40 });
        if (/https?:\/\/|www\./iu.test(modal.content)) throw new TypeError('Confirmation text cannot contain a URL');
        for (const key of ['confirm_text', 'cancel_text']) if (modal[key] !== undefined) qqString(modal[key], `${path}.action.modal.${key}`, { max: 4 });
      }
    });
  });
}

function mediaSource(value) {
  qqObject(value, ['url', 'buffer', 'base64'], 'source');
  const keys = Object.keys(value);
  if (keys.length !== 1) throw new TypeError('source requires exactly one of url/buffer/base64');
  if (keys[0] === 'url') return { url: qqHttpsUrl(value.url, 'source.url', 4096) };
  let buffer;
  if (keys[0] === 'buffer') {
    if (!Buffer.isBuffer(value.buffer) && !(value.buffer instanceof Uint8Array)) throw new TypeError('source.buffer must be bytes');
    buffer = Buffer.from(value.buffer);
  } else {
    if (typeof value.base64 !== 'string' || value.base64.length > Math.ceil(MAX_MEDIA_BYTES / 3) * 4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value.base64)) {
      throw new TypeError('source.base64 must contain canonical base64 bytes');
    }
    buffer = Buffer.from(value.base64, 'base64');
  }
  if (!buffer.length || buffer.length > MAX_MEDIA_BYTES) throw new TypeError('QQ media must contain 1-200 MiB of bytes');
  return { buffer };
}

/** Public payload contract: explicit type, no raw provider body passthrough. */
export function validateQqRichMessage(value) {
  if (!value || typeof value !== 'object') throw new TypeError('Rich message is required');
  qqEnum(value.type, ['text', 'markdown', 'tuwen', ...Object.keys(MEDIA_METHODS)], 'message.type');
  if (['text', 'markdown'].includes(value.type)) {
    qqObject(value, ['type', 'text', 'keyboard'], 'message');
    qqString(value.text, 'message.text', { max: 16_000 });
    if (value.keyboard !== undefined) validateKeyboard(value.keyboard);
    return structuredClone(value);
  }
  if (value.type === 'tuwen') {
    qqObject(value, ['type', 'title', 'description', 'url', 'pic_url'], 'message');
    qqString(value.title, 'message.title', { max: 50 });
    qqString(value.description, 'message.description', { max: 200 });
    qqHttpsUrl(value.url, 'message.url');
    qqHttpsUrl(value.pic_url, 'message.pic_url');
    return structuredClone(value);
  }
  qqObject(value, ['type', 'source', 'caption', 'fileName'], 'message');
  if (value.caption !== undefined) {
    if (value.type === 'voice') throw new TypeError('QQ voice messages do not support a caption');
    qqString(value.caption, 'message.caption', { max: 4096 });
  }
  if (value.fileName !== undefined) {
    if (value.type !== 'file') throw new TypeError('fileName is only supported for file messages');
    qqString(value.fileName, 'message.fileName', { max: 255 });
    if (/[\/\\\r\n]/u.test(value.fileName)) throw new TypeError('fileName must be a filename without path components');
  }
  return { ...value, source: mediaSource(value.source) };
}

/** Invoke the corresponding SDK send path once, retaining unknown outcomes. */
export async function sendQqRichMessage(bot, target, payload, { signal, timeoutMs = 120_000 } = {}) {
  const route = validateQqReplyTarget(target);
  const message = validateQqRichMessage(payload);
  qqInteger(timeoutMs, 'timeoutMs', 1, 120_000);
  const method = MEDIA_METHODS[message.type] ?? 'send';
  if (typeof bot?.[method] !== 'function') {
    const error = new Error(`QQ SDK ${method}() is unavailable`);
    error.code = 'qq-feature-unavailable';
    throw error;
  }
  let dispatched = false;
  try {
    return await withQqOperation((operationSignal) => {
      operationSignal.throwIfAborted();
      dispatched = true;
      if (MEDIA_METHODS[message.type]) return bot[method](route, message.source, {
        ...(message.caption !== undefined ? { content: message.caption } : {}),
        ...(message.fileName !== undefined ? { fileName: message.fileName } : {}),
        onProgress: () => operationSignal.throwIfAborted(),
      });
      if (message.type === 'tuwen') {
        const { type: _type, ...content } = message;
        return bot.send({ target: route, msgType: 8, extra: { card: { type: 'tuwen', content } } });
      }
      return bot.send({ target: route, msgType: message.type === 'text' ? 0 : 2,
        ...(message.type === 'text' ? { content: message.text } : { markdown: { content: message.text } }),
        ...(message.keyboard !== undefined ? { keyboard: message.keyboard } : {}),
      });
    }, { signal, timeoutMs });
  } catch (cause) {
    if (!dispatched) throw cause;
    const error = new Error(isDefinitiveQqRejection(cause)
      ? 'QQ rejected the rich message; no fallback was sent'
      : 'QQ rich-message delivery could not be confirmed; check the chat before retrying', { cause });
    error.code = isDefinitiveQqRejection(cause) ? 'qq-message-rejected' : 'qq-delivery-uncertain';
    error.httpStatus = cause?.httpStatus;
    error.bizCode = cause?.bizCode;
    throw error;
  }
}
