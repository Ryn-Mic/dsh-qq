import { COMMAND_PERMISSION_DENIED_MESSAGE, evaluateInboundAccess } from '../shared/inbound-access.mjs';
import { t } from '../shared/i18n.mjs';
import { parseQqMenuCommand } from './qq-menu.mjs';

const nonEmpty = (value) => typeof value === 'string' && value.trim() ? value.trim() : '';
const rejected = () => ({ code: 1, error: t('菜单命令无效，请发送 /m 重新打开。') });

// SDK 1.0.4 forwards INTERACTION_CREATE unchanged. QQ private/group button
// callbacks use type=11, data.type=11, chat_type=2/1 respectively. Only the
// platform fields identify the actor and reply route; button_data is untrusted.
export function qqMenuInteraction(event, appId) {
  if (!nonEmpty(event?.id) || event?.type !== 11 || event?.data?.type !== 11 || event.version !== 1
    || (event.application_id !== undefined && String(event.application_id) !== String(appId))) return rejected();
  const resolved = event.data.resolved;
  if (typeof resolved?.button_data !== 'string') return rejected();
  const parsed = parseQqMenuCommand(resolved.button_data);
  if (!parsed.token || !Number.isSafeInteger(parsed.number)
    || nonEmpty(resolved.button_id) !== `${parsed.token}_${parsed.number}`) return rejected();
  let kind;
  let actor;
  let targetId;
  if (event.chat_type === 1 && (!event.scene || event.scene === 'group')) {
    kind = 'group'; actor = nonEmpty(event.group_member_openid); targetId = nonEmpty(event.group_openid);
    if (nonEmpty(event.user_openid)) return rejected();
  } else if (event.chat_type === 2 && (!event.scene || event.scene === 'c2c')) {
    kind = 'c2c'; actor = nonEmpty(event.user_openid); targetId = actor;
    if (nonEmpty(event.group_openid) || nonEmpty(event.group_member_openid)) return rejected();
  }
  if (!actor || !targetId) return rejected();
  return { ...parsed, kind, actor, route: `${kind}:${targetId}`,
    target: { scope: kind, targetId, eventId: nonEmpty(event.id) }, text: `/m pick ${parsed.token} ${parsed.number}` };
}

function awaitAcknowledgement(task, remainingMs, signal) {
  let timer;
  let onAbort;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('QQ interaction acknowledgement timed out')), remainingMs);
    if (signal) {
      onAbort = () => reject(signal.reason ?? new Error('QQ runtime stopped'));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    }
  });
  return Promise.race([task, deadline]).finally(() => {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  });
}

export function createQqInteractionHandler({
  bot, replyBot = bot, bridge, appId, ownerUserOpenid, accessPolicy, signal, logger = console,
  now = Date.now, acknowledgementDeadlineMs = 2_500,
}) {
  const acknowledged = new Set();
  return async (ctx, event) => {
    if (signal?.aborted || event?.type !== 11) return;
    const id = nonEmpty(event?.id);
    // This context contract is the SDK's interaction event, not a message or
    // arbitrary button payload supplied to a public command endpoint.
    if (!id || ctx?.bot !== bot || ctx?.event !== event) return;
    const receivedAt = Number.isFinite(ctx.receivedAt) ? ctx.receivedAt : now();
    const remaining = () => acknowledgementDeadlineMs - Math.max(0, now() - receivedAt);
    if (remaining() <= 0) return { code: 1, expired: true };
    if (acknowledged.has(id)) return { code: 3, duplicate: true };
    // Reserve before any await, including failed ACKs: never ACK the same
    // provider event twice or execute after an uncertain acknowledgement.
    acknowledged.add(id);
    const choice = qqMenuInteraction(event, appId);
    let decision = choice;
    if (!choice.error) {
      const access = accessPolicy ? evaluateInboundAccess(accessPolicy, {
        conversationType: choice.kind === 'c2c' ? 'direct' : 'group',
        senderIds: choice.actor, text: choice.text, isCommand: true,
      }) : { allowed: choice.kind === 'group' || ownerUserOpenid === '*' || choice.actor === ownerUserOpenid };
      if (!access.allowed) {
        decision = { code: 4, error: t(COMMAND_PERMISSION_DENIED_MESSAGE) };
      } else {
        try {
          decision = bridge.validateMenuInteraction(choice);
          if (!decision?.error && !decision?.action) decision = rejected();
        } catch {
          decision = rejected();
        }
      }
    }
    const code = decision?.error ? decision.code ?? 1 : 0;
    const remainingMs = remaining();
    if (remainingMs <= 0) return { code: 1, expired: true };
    try {
      // Code 0 acknowledges receipt; all Host work begins only after this
      // request succeeds. It does not claim the operation has completed.
      await awaitAcknowledgement(bot.acknowledgeInteraction(id, code), remainingMs, signal);
    } catch (error) {
      if (!signal?.aborted) logger.warn?.('[dsh-im:qq] interaction acknowledgement failed:', error?.message);
      return { code, acknowledged: false };
    }
    if (signal?.aborted) return { code, acknowledged: true };
    if (remaining() <= 0) return { code, acknowledged: true, expired: true };
    if (decision?.error) {
      if (!choice.error && code !== 4) await replyBot.sendText(choice.target, decision.error);
      return { code, acknowledged: true };
    }
    // The synthetic ID is only a local deduplication key. An interaction ID
    // is never a normal passive msg_id; the delivery adapter sends event_id.
    const message = {
      kind: choice.kind, senderId: choice.actor, senderIsBot: false,
      groupOpenid: choice.kind === 'group' ? choice.target.targetId : undefined,
      rawEventType: choice.kind === 'group' ? 'GROUP_AT_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
      messageId: `qq-interaction:${id}`, content: choice.text, replyTarget: choice.target,
      raw: { content: choice.text },
    };
    await Promise.resolve().then(() => {
      if (!signal?.aborted) return bridge.accept(message);
    });
    return { code, acknowledged: true };
  };
}
