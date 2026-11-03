import * as React from 'react';
import { h } from '../../i18n.js';

export function QqEnhancementsEditor({ account, disabled = false, onManage, onFeaturesSave }) {
  const [kind, setKind] = React.useState('menu');
  const [draft, setDraft] = React.useState('');
  const [panelId, setPanelId] = React.useState('');
  const [confirmed, setConfirmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [result, setResult] = React.useState('');
  const [backup, setBackup] = React.useState(null);
  const running = React.useRef(false);
  const mounted = React.useRef(true);
  const id = React.useId();
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const run = async (operation) => {
    if (running.current || disabled) return;
    running.current = true;
    setBusy(true); setError('');
    try {
      const value = await operation();
      if (mounted.current && value !== undefined) setResult(JSON.stringify(value, null, 2));
    } catch (cause) {
      if (mounted.current) {
        setError(cause?.message ?? 'QQ 操作失败');
        if (cause?.menuRestore || cause?.menuBackup) setBackup(cause.menuRestore ?? cause.menuBackup);
        if (cause?.reconciliationRequired) setConfirmed(false);
      }
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const manage = (action, args = {}, confirm = false) => {
    if (typeof onManage !== 'function') throw new Error('QQ 管理接口不可用');
    return onManage(action, args, confirm);
  };
  const loadDefaults = () => run(async () => {
    const value = await manage('defaults');
    if (mounted.current) { setDraft(JSON.stringify(value[kind], null, 2)); setConfirmed(false); }
  });
  const read = () => run(async () => {
    const value = await manage(kind === 'menu' ? 'getMenu' : 'getPanel', { ...(kind === 'panel' ? { panelId: panelId.trim() } : {}) });
    if (mounted.current) {
      const config = kind === 'menu' ? value.menu ?? value : { panel: value.panel ?? value };
      setDraft(JSON.stringify(config, null, 2)); setConfirmed(false);
    }
    return value;
  });
  const write = (mode = 'save') => run(async () => {
    if (!confirmed) throw new Error('请先确认将修改 QQ 平台配置。');
    const value = mode === 'delete' ? null : JSON.parse(draft);
    if (kind === 'menu') {
      // Read immediately before the destructive replacement. Failure prevents a
      // write; a retained/downloadable backup survives even a failed write.
      const current = await manage('getMenu');
      if (mounted.current) setBackup({ menu: current.menu ?? current });
      const saved = await manage('putMenu', { menu: value,
        ...(Number.isSafeInteger(current.version) ? { expectedVersion: current.version } : {}),
      }, true);
      if (mounted.current) setConfirmed(false);
      return saved;
    }
    if (mode === 'delete') {
      const current = await manage('getPanel', { panelId: panelId.trim() });
      if (mounted.current) setBackup(current);
      const saved = await manage('deletePanel', { panelId: panelId.trim() }, true);
      if (mounted.current) setConfirmed(false);
      return saved;
    }
    const editing = Boolean(panelId.trim());
    if (editing) {
      const current = await manage('getPanel', { panelId: panelId.trim() });
      if (mounted.current) setBackup(current);
    }
    const saved = await manage(editing ? 'updatePanel' : 'createPanel', {
      ...(editing ? { panelId: panelId.trim() } : {}), panel: value,
    }, true);
    if (mounted.current) {
      if (typeof saved?.panel_id === 'string') setPanelId(saved.panel_id);
      setConfirmed(false);
    }
    return saved;
  });
  const blocked = disabled || busy;
  const offline = !account.connected;
  const button = (action, label, onClick, extraDisabled = false) => h('button', {
    type: 'button', className: 'ddt-button', 'data-qq-action': action,
    disabled: blocked || extraDisabled, onClick,
  }, label);

  return h('details', { className: 'dqq-enhancements' },
    h('summary', null, 'QQ 交互增强'),
    h('p', null, '功能菜单优先使用按钮回调，不支持时回退为指令按钮或数字。'),
    h('label', { className: 'dqq-check' },
      h('input', {
        type: 'checkbox', checked: account.features?.streamingEnabled === true,
        disabled: blocked, 'data-qq-action': 'streaming',
        onChange: (event) => {
          const enabled = event.target.checked;
          return run(() => onFeaturesSave?.(enabled));
        },
      }), '单聊流式回复（实验）'),
    h('p', null, '默认等待完整回答。流式设置从下一轮对话生效，群聊仍发送最终回答。'),
    h('div', { className: 'dqq-enhancementsTools' },
      h('label', { htmlFor: `${id}-kind` }, '平台配置'),
      h('select', {
        id: `${id}-kind`, value: kind, disabled: blocked,
        onChange: (event) => { setKind(event.target.value); setDraft(''); setConfirmed(false); setResult(''); },
      }, h('option', { value: 'menu' }, '全局私聊菜单'), h('option', { value: 'panel' }, '指令面板')),
      button('defaults', '载入推荐配置', loadDefaults)),
    kind === 'panel' ? h(React.Fragment, null,
      h('label', { htmlFor: `${id}-panel` }, '面板 ID（创建时留空）'),
      h('input', { id: `${id}-panel`, value: panelId, disabled: blocked,
        onChange: event => { setPanelId(event.target.value); setDraft(''); setConfirmed(false); setResult(''); } }),
      button('listPanels', '读取面板列表', () => run(() => manage('listPanels')), offline)) : null,
    h('label', { htmlFor: `${id}-draft` }, '配置预览与编辑'),
    h('textarea', {
      id: `${id}-draft`, value: draft, rows: 9, spellCheck: false, disabled: blocked,
      onChange: event => { setDraft(event.target.value); setConfirmed(false); },
    }),
    h('p', null, kind === 'menu'
      ? '应用将覆盖这只机器人的全局私聊菜单。保存前会读取备份，可下载恢复。'
      : '指令名称会填入 QQ 输入框。更新和删除前会读取备份；新建不会覆盖其它面板。'),
    h('label', { className: 'dqq-check' },
      h('input', { type: 'checkbox', checked: confirmed, disabled: blocked,
        'data-qq-action': 'confirm', onChange: event => setConfirmed(event.target.checked) }),
      '确认修改这只机器人的 QQ 平台配置'),
    h('div', { className: 'dqq-enhancementsTools' },
      button('read', '读取当前配置', read, offline || (kind === 'panel' && !panelId.trim())),
      button('save', kind === 'menu' ? '应用菜单' : panelId.trim() ? '更新面板' : '创建面板',
        () => write(), offline || !confirmed || !draft.trim()),
      kind === 'panel' ? button('delete', '删除面板', () => write('delete'), offline || !confirmed || !panelId.trim()) : null),
    error ? h('p', { role: 'alert' }, error) : null,
    result ? h('pre', { role: 'status' }, result) : null,
    backup ? h('a', { download: `qq-platform-backup-${account.botId}.json`,
      href: `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(backup, null, 2))}`,
    }, '下载修改前备份') : null,
  );
}
