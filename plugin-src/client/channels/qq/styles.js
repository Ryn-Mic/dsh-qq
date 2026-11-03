export const QQ_STYLE_ID = 'ryn-mic-dsh-qq-qq-settings';

const CSS = String.raw`
.dqq-page { --ddt-accent: #1677ff; --ddt-accent-deep: #0958d9; --ddt-accent-wash: #eaf3ff; }
.dqq-avatar, .dqq-brand { color: #fff; background: #1677ff; }
.dqq-avatar svg, .dqq-brand svg { display: block; }
.dqq-enhancements { margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(128,128,128,.24); }
.dqq-enhancements summary { cursor: pointer; font-weight: 600; }
.dqq-enhancements p { line-height: 1.6; font-size: 12px; opacity: .8; }
.dqq-enhancements textarea, .dqq-enhancements input:not([type="checkbox"]), .dqq-enhancements select { box-sizing: border-box; width: 100%; padding: 8px; color: inherit; background: transparent; border: 1px solid rgba(128,128,128,.3); border-radius: 6px; font: inherit; }
.dqq-enhancements textarea { display: block; margin: 6px 0 10px; font-family: ui-monospace, monospace; resize: vertical; }
.dqq-enhancements pre { max-height: 240px; overflow: auto; font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; }
.dqq-enhancementsTools { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0; }
.dqq-enhancementsTools select { width: auto; }
.dqq-check { display: flex; align-items: center; gap: 7px; margin: 10px 0; }
`;

export function installQqStyles() {
  if (typeof document === 'undefined') return () => {};
  const existing = document.querySelector(`style[data-plugin-css="${QQ_STYLE_ID}"]`);
  if (existing) return () => {};
  const style = document.createElement('style');
  style.dataset.plugin = '@ryn-mic/dsh-qq';
  style.dataset.pluginCss = QQ_STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  return () => style.remove();
}
