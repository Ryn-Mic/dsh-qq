import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultMenu, defaultPanel, nativeMenuDiff, qqCharacterWidth, validateNativeMenu,
  validatePanelCreate, validatePanelList, validatePanelTargets, validatePanelUpdate,
} from '../../../src/channels/qq/native-menu.mjs';

const menu = (item) => ({ menu: { items: [item] } });

test('QQ native defaults preserve input-box commands and are valid without publishing', () => {
  assert.deepEqual(validateNativeMenu(defaultMenu()), defaultMenu());
  const panel = defaultPanel();
  assert.deepEqual(validatePanelCreate(panel), panel);
  assert.equal(panel.panel.items.find((item) => item.name === '/sessions').desc, '选择会话');
  assert.equal(panel.panel.items.some((item) => Object.hasOwn(item, 'command')), false);
  assert.equal(defaultMenu().menu.items[0].send_message, '/m');
});

test('QQ native labels use the documented double-width Chinese limits', () => {
  assert.equal(qqCharacterWidth('中文abc😀'), 9);
  validateNativeMenu(menu({ type: 'send_message', name: '一二三四五', send_message: '/m' }));
  assert.throws(() => validateNativeMenu(menu({ type: 'send_message', name: '一二三四五六', send_message: '/m' })), /QQ characters/u);
  const body = menu({ type: 'menu', name: '更多', sub_menu_items: [
    { type: 'send_message', name: '一二三四五六七', send_message: '/m' },
  ] });
  validateNativeMenu(body);
  body.menu.items[0].sub_menu_items[0].name += '八';
  assert.throws(() => validateNativeMenu(body), /QQ characters/u);
  const panel = defaultPanel();
  panel.panel.items[0].name = '一二三四五六七八';
  assert.throws(() => validatePanelCreate(panel), /QQ characters/u);
});

test('QQ native menus enforce item counts, nesting, field/type matching and HTTPS', () => {
  assert.throws(() => validateNativeMenu({ menu: { items: Array.from({ length: 11 }, () => ({ type: 'send_message', name: '帮助', send_message: '/help' })) } }), /0-10/u);
  assert.throws(() => validateNativeMenu(menu({ type: 'menu', name: '多', sub_menu_items: Array.from({ length: 6 }, () => ({ type: 'link', name: '页', link: 'https://example.com' })) })), /1-5/u);
  assert.throws(() => validateNativeMenu(menu({ type: 'menu', name: '多', sub_menu_items: [{ type: 'menu', name: '多', sub_menu_items: [] }] })), /type/u);
  assert.throws(() => validateNativeMenu(menu({ type: 'link', name: '官网', link: 'http://example.com' })), /HTTPS/u);
  assert.throws(() => validateNativeMenu(menu({ type: 'link', name: '官网', link: 'https://user:secret@example.com' })), /credentials/u);
  assert.throws(() => validateNativeMenu(menu({ type: 'send_message', name: '帮助', send_message: '/help', link: 'https://example.com' })), /does not match/u);
  assert.throws(() => validateNativeMenu({ ...defaultMenu(), extra: true }), /not supported/u);
  assert.throws(() => validateNativeMenu({ menu: { items: Array(2) } }), /missing entries/u);
  assert.throws(() => validateNativeMenu(menu({ type: 'switch', name: '搜', switch: { switch_id: 'search', default: 'false' } })), /boolean/u);
});

test('QQ panels validate scope, target type, explicit input names and all list limits', () => {
  const specific = { ...defaultPanel('group'), target_type: 'specific', group_openids: ['group-a'] };
  validatePanelCreate(specific);
  assert.throws(() => validatePanelCreate({ ...specific, user_openids: ['user-a'] }), /does not match/u);
  assert.throws(() => validatePanelCreate({ ...defaultPanel('channel'), target_type: 'specific', user_openids: ['u'] }), /only support/u);
  assert.throws(() => validatePanelCreate({ ...specific, group_openids: Array(21).fill('group') }), /1-20/u);
  assert.throws(() => validatePanelCreate({ ...specific, group_openids: ['same', 'same'] }), /duplicate/u);
  assert.throws(() => validatePanelUpdate({ panel: { items: Array(21).fill({ type: 'command', name: '/m' }) } }), /0-20/u);
  assert.throws(() => validatePanelUpdate({ panel: { items: [{ type: 'command', name: '/m', command: '/stop' }] } }), /not supported/u);
  assert.throws(() => validatePanelTargets({ op: 'add', user_openids: ['u'], group_openids: ['g'] }), /exactly one/u);
  assert.throws(() => validatePanelTargets({ op: 'delete', user_openids: ['u'] }), /one of/u);
  assert.throws(() => validatePanelList({ scope: 'c2c', limit: 51 }), /1 and 50/u);
  assert.throws(() => validatePanelList({ scope: 'c2c', arbitrary: true }), /not supported/u);
});

test('QQ native menu preview retains exact before/restore snapshots and compares object keys semantically', () => {
  const before = { version: 12, menu: { items: [{ name: '帮助', send_message: '/help', type: 'send_message' }] } };
  const desired = menu({ type: 'send_message', name: '帮助', send_message: '/help' });
  const diff = nativeMenuDiff(before, desired);
  assert.equal(diff.changed, false);
  assert.deepEqual(diff.before, before);
  assert.deepEqual(diff.restore, { menu: before.menu });
  before.menu.items[0].name = '已修改';
  assert.equal(diff.restore.menu.items[0].name, '帮助');
  assert.deepEqual(nativeMenuDiff({ version: 0, menu: null }, { menu: { items: [] } }).restore, { menu: { items: [] } });
});
