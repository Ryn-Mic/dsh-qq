import {
  qqArray, qqBoolean, qqEnum, qqHttpsUrl, qqInteger, qqObject, qqString,
} from './qq-validation.mjs';

export { qqCharacterWidth } from './qq-validation.mjs';
export const QQ_PANEL_SCOPES = Object.freeze(['c2c', 'group', 'channel', 'dm']);

function menuItem(value, path, child = false) {
  qqObject(value, ['name', 'type', 'send_message', 'link', 'switch', 'sub_menu_items'], path);
  qqString(value.name, `${path}.name`, { max: child ? 14 : 10, wide: true });
  qqEnum(value.type, child ? ['send_message', 'link'] : ['switch', 'send_message', 'link', 'menu'], `${path}.type`);
  const field = { send_message: 'send_message', link: 'link', switch: 'switch', menu: 'sub_menu_items' }[value.type];
  for (const key of ['send_message', 'link', 'switch', 'sub_menu_items']) {
    if (key !== field && key in value) throw new TypeError(`${path}.${key} does not match type=${value.type}`);
  }
  if (value.type === 'send_message') qqString(value.send_message, `${path}.send_message`);
  if (value.type === 'link') qqHttpsUrl(value.link, `${path}.link`);
  if (value.type === 'switch') {
    qqObject(value.switch, ['switch_id', 'default'], `${path}.switch`);
    qqString(value.switch.switch_id, `${path}.switch.switch_id`, { max: 128 });
    if (value.switch.default !== undefined) qqBoolean(value.switch.default, `${path}.switch.default`);
  }
  if (value.type === 'menu') {
    qqArray(value.sub_menu_items, `${path}.sub_menu_items`, 5, 1)
      .forEach((item, index) => menuItem(item, `${path}.sub_menu_items[${index}]`, true));
  }
}

/** PUT /v2/menu body. Validation never rewrites names, commands or ordering. */
export function validateNativeMenu(value) {
  qqObject(value, ['menu'], 'menuBody');
  qqObject(value.menu, ['items'], 'menuBody.menu');
  qqArray(value.menu.items, 'menuBody.menu.items', 10)
    .forEach((item, index) => menuItem(item, `menuBody.menu.items[${index}]`));
  return structuredClone(value);
}

function panel(value, path = 'panel') {
  qqObject(value, ['items', 'remark', 'version'], path);
  qqArray(value.items, `${path}.items`, 20).forEach((item, index) => {
    const itemPath = `${path}.items[${index}]`;
    qqObject(item, ['name', 'desc', 'type', 'only_admin', 'link'], itemPath);
    qqEnum(item.type, ['command', 'link'], `${itemPath}.type`);
    // For commands name IS the input text. There is no separate command field.
    qqString(item.name, `${itemPath}.name`, { max: 14, wide: true });
    if (item.desc !== undefined) qqString(item.desc, `${itemPath}.desc`, { min: 0, max: 30, wide: true });
    if (item.only_admin !== undefined) qqBoolean(item.only_admin, `${itemPath}.only_admin`);
    if (item.type === 'link') qqHttpsUrl(item.link, `${itemPath}.link`);
    else if ('link' in item) throw new TypeError(`${itemPath}.link is only valid for link elements`);
  });
  if (value.remark !== undefined) qqString(value.remark, `${path}.remark`, { min: 0, max: 255 });
  if (value.version !== undefined) qqInteger(value.version, `${path}.version`, 0, Number.MAX_SAFE_INTEGER);
}

function openids(value, path) {
  qqArray(value, path, 20, 1).forEach((id, index) => qqString(id, `${path}[${index}]`, { max: 256 }));
  if (new Set(value).size !== value.length) throw new TypeError(`${path} must not contain duplicate IDs`);
}

export function validatePanelCreate(value) {
  qqObject(value, ['scope', 'target_type', 'user_openids', 'group_openids', 'panel'], 'panelBody');
  qqEnum(value.scope, QQ_PANEL_SCOPES, 'panelBody.scope');
  const targetType = value.target_type ?? 'all';
  qqEnum(targetType, ['all', 'specific'], 'panelBody.target_type');
  if (['channel', 'dm'].includes(value.scope) && targetType !== 'all') {
    throw new TypeError('Channel and DM panels only support target_type=all');
  }
  const targetKey = value.scope === 'c2c' ? 'user_openids' : value.scope === 'group' ? 'group_openids' : null;
  for (const key of ['user_openids', 'group_openids']) {
    if (key in value && (targetType !== 'specific' || key !== targetKey)) {
      throw new TypeError(`panelBody.${key} does not match scope and target_type`);
    }
  }
  if (targetType === 'specific') openids(value[targetKey], `panelBody.${targetKey}`);
  panel(value.panel, 'panelBody.panel');
  return structuredClone(value);
}

export function validatePanelUpdate(value) {
  qqObject(value, ['panel'], 'panelBody');
  panel(value.panel, 'panelBody.panel');
  return structuredClone(value);
}

export function validatePanelTargets(value) {
  qqObject(value, ['op', 'user_openids', 'group_openids'], 'targets');
  qqEnum(value.op, ['add', 'del'], 'targets.op');
  const keys = ['user_openids', 'group_openids'].filter((key) => key in value);
  if (keys.length !== 1) throw new TypeError('targets must contain exactly one openid list');
  openids(value[keys[0]], `targets.${keys[0]}`);
  return structuredClone(value);
}

export function validatePanelList(value) {
  qqObject(value, ['scope', 'cursor', 'limit'], 'panelQuery');
  qqEnum(value.scope, QQ_PANEL_SCOPES, 'panelQuery.scope');
  if (value.cursor !== undefined) qqString(value.cursor, 'panelQuery.cursor', { min: 0, max: 2048 });
  if (value.limit !== undefined) qqInteger(value.limit, 'panelQuery.limit', 1, 50);
  return structuredClone(value);
}

export function validatePanelId(value) {
  qqString(value, 'panelId', { max: 256 });
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new TypeError('Invalid panelId');
  return value;
}

/** Explicit, reviewable defaults; these are never published on bot startup. */
export function defaultMenu() {
  return { menu: { items: [
    { type: 'send_message', name: '助手菜单', send_message: '/m' },
    { type: 'send_message', name: '会话', send_message: '/sessions' },
    { type: 'send_message', name: '模型', send_message: '/models' },
    { type: 'menu', name: '更多', sub_menu_items: [
      { type: 'send_message', name: '工作区', send_message: '/workspaces' },
      { type: 'send_message', name: '新会话', send_message: '/new' },
      { type: 'send_message', name: '状态', send_message: '/status' },
      { type: 'send_message', name: '帮助', send_message: '/help' },
    ] },
  ] } };
}

export function defaultPanel(scope = 'c2c') {
  return validatePanelCreate({ scope, target_type: 'all', panel: { remark: 'DSH QQ 助手快捷指令', items: [
    { type: 'command', name: '/m', desc: '助手菜单' },
    { type: 'command', name: '/sessions', desc: '选择会话' },
    { type: 'command', name: '/models', desc: '选择模型' },
    { type: 'command', name: '/workspaces', desc: '选择工作区' },
    { type: 'command', name: '/new', desc: '新会话' },
    { type: 'command', name: '/status', desc: '连接状态' },
    { type: 'command', name: '/help', desc: '帮助' },
  ] } });
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function nativeMenuDiff(current, proposed) {
  const next = validateNativeMenu(proposed);
  const before = structuredClone(current);
  const previous = { menu: before?.menu ?? { items: [] } };
  return {
    changed: canonical(previous) !== canonical(next),
    before, proposed: next,
    // Retain the exact server menu for an explicit future restore.
    restore: structuredClone(previous),
  };
}
