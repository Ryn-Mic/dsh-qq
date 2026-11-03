import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

import { transform } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TestRenderer from 'react-test-renderer';

import {
  apply as applyClient,
  IM_PLUGIN_VERSION,
  IMSettingsTab,
  inject as clientInject,
} from '../plugin-src/client/index.js';
import { CredentialBindingPanel } from '../plugin-src/client/credential-binding.js';
import { ChannelListHeading } from '../plugin-src/client/channel-card-meta.js';
import { installImStyles } from '../plugin-src/client/styles.js';
import {
  AccountCard as QqAccountCard,
  QqSettingsTab,
} from '../plugin-src/client/channels/qq/index.js';
import {
  en,
  IM_LOCALE_NAMESPACE,
  localizeText,
  setImTranslator,
  zh,
} from '../plugin-src/client/i18n.js';
import {
  GLOBAL_SETTINGS_RPC_CHANNEL,
  GlobalSettingsPanel,
} from '../plugin-src/client/global-settings.js';
import {
  HOST_LANGUAGE_ENDPOINTS,
  HOST_LANGUAGE_RPC_CHANNEL,
} from '../plugin-src/client/interface-language.js';

const STYLES_URL = new URL('../plugin-src/client/styles.js', import.meta.url);
const FEISHU_STYLES_URL = new URL(
  '../plugin-src/client/channels/qq/styles.js',
  import.meta.url,
);
const WEIXIN_STYLES_URL = new URL(
  '../plugin-src/client/channels/qq/styles.js',
  import.meta.url,
);
const DINGTALK_STYLES_URL = new URL(
  '../plugin-src/client/channels/shared/connection-styles.js',
  import.meta.url,
);
const WECOM_STYLES_URL = new URL(
  '../plugin-src/client/channels/qq/styles.js',
  import.meta.url,
);
const FEISHU_SOURCE_URL = new URL(
  '../plugin-src/client/channels/qq/index.js',
  import.meta.url,
);
const WEIXIN_SOURCE_URL = new URL(
  '../plugin-src/client/channels/qq/index.js',
  import.meta.url,
);
const CLIENT_BUNDLE_URL = new URL('../lib/client.js', import.meta.url);
const CLIENT_SOURCE_DIRECTORY_URL = new URL('../plugin-src/client/', import.meta.url);
const DINGTALK_CLIENT_SOURCE_URL = new URL(
  '../plugin-src/client/channels/qq/index.js',
  import.meta.url,
);
const WECOM_SOURCE_URL = new URL(
  '../plugin-src/client/channels/qq/index.js',
  import.meta.url,
);
const QQ_SOURCE_URL = new URL(
  '../plugin-src/client/channels/qq/index.js',
  import.meta.url,
);

const { act, create } = TestRenderer;

async function flushMicrotasks() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

// Drains every pending microtask and timer callback, like the Feishu channel
// tests use, so multi-hop save chains settle before assertions.
const flushTasks = () => new Promise((resolve) => setImmediate(resolve));

function nodeText(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node) return '';
  const children = Array.isArray(node) ? node : node.children;
  return Array.isArray(children) ? children.map(nodeText).join('') : nodeText(children);
}

function findButton(renderer, label) {
  const button = renderer.root.findAllByType('button')
    .find((candidate) => nodeText(candidate) === label);
  assert.ok(button, `missing button: ${label}`);
  return button;
}

test('removing the first account preserves collapse styles and toggling for remaining accounts', () => {
  const previousDocument = globalThis.document;
  const styles = new Set();
  globalThis.document = {
    querySelector: (selector) => [...styles].find((style) =>
      selector === `style[data-plugin-css="${style.dataset.pluginCss}"]`) ?? null,
    createElement: () => {
      const style = { dataset: {}, textContent: '', remove: () => styles.delete(style) };
      return style;
    },
    head: { appendChild: (style) => styles.add(style) },
  };
  const cards = (ids) => React.createElement(React.Fragment, null, ids.map((botId) =>
    React.createElement(QqAccountCard, {
      key: botId,
      account: {
        botId, connected: true, state: 'connected',
        bot: { name: botId, appIdMasked: '123••456' },
        health: { summary: 'Connected', lastCheckedAt: null },
      },
    })));
  const collapseStyles = () => [...styles].find((style) =>
    style.textContent.includes('.dim-collapsibleAccount:not(.is-open)'));
  let renderer;
  let disposeStyles;
  try {
    disposeStyles = installImStyles();
    act(() => { renderer = create(cards(['first', 'second'])); });
    const stylesheet = collapseStyles();
    assert.ok(stylesheet);

    act(() => renderer.update(cards(['second'])));
    assert.equal(collapseStyles(), stylesheet, 'remaining cards still need the shared collapse CSS');
    const header = () => renderer.root.findByProps({ className: 'dim-collapsibleHead' });
    const toggle = () => renderer.root.findByProps({ className: 'dim-accountSettingsToggle' });
    assert.equal(toggle().props['aria-expanded'], 'false');
    act(() => header().props.onClick());
    assert.equal(toggle().props['aria-expanded'], 'true');
    act(() => toggle().props.onClick({ stopPropagation() {} }));
    assert.equal(toggle().props['aria-expanded'], 'false');

    act(() => renderer.unmount());
    disposeStyles();
    assert.equal(styles.size, 0, 'disposing the settings styles still cleans up the document');
  } finally {
    act(() => renderer?.unmount());
    disposeStyles?.();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('IM settings renders only QQ plus shared general settings', async () => {
  const { default: packageMetadata } = await import('../package.json', {
    with: { type: 'json' },
  });
  const { version: packageVersion } = packageMetadata;
  const styles = await readFile(STYLES_URL, 'utf8');
  const markup = renderToStaticMarkup(React.createElement(IMSettingsTab, {
    feishuRpcCall: async () => ({ ok: true, value: {} }),
    weixinRpcCall: async () => ({ ok: true, value: {} }),
    dingtalkRpcCall: async () => ({ ok: true, value: {} }),
    wecomRpcCall: async () => ({ ok: true, value: {} }),
    wecomAppRpcCall: async () => ({ ok: true, value: {} }),
    qqRpcCall: async () => ({ ok: true, value: {} }),
    slackRpcCall: async () => ({ ok: true, value: {} }),
    telegramRpcCall: async () => ({ ok: true, value: {} }),
    discordRpcCall: async () => ({ ok: true, value: {} }),
    whatsappRpcCall: async () => ({ ok: true, value: {} }),
    imessageRpcCall: async () => ({ ok: true, value: {} }),
    emailRpcCall: async () => ({ ok: true, value: {} }),
    officeRpcCall: async () => ({ ok: true, value: {} }),
  }));

  assert.match(markup, /IM机器人/);
  assert.match(markup, /让 DeepSeek Harness 触手可及/);
  assert.match(markup, /class="dim-brand"/);
  assert.equal(IM_PLUGIN_VERSION, packageVersion);
  assert.match(markup, new RegExp(
    `<div class="dim-brandHeading"><strong class="dim-brandName">DSH-QQ<\\/strong><span class="dim-brandVersion">v${packageVersion.replaceAll('.', '\\.')}<\\/span><\\/div>`,
  ));
  assert.doesNotMatch(markup, /dim-versionTooltip|当前版本/);
  assert.doesNotMatch(markup, /dim-brandLogo|<img/);
  assert.match(markup, /href="https:\/\/github\.com\/Ryn-Mic\/dsh-qq"/);
  assert.match(markup, /target="_blank"/);
  assert.match(markup, /rel="noopener noreferrer"/);
  assert.match(markup, /aria-label="dsh-qq GitHub"/);
  assert.doesNotMatch(markup, /dim-updateTrigger|检查更新/);
  assert.ok(markup.indexOf('dim-githubAction') < markup.indexOf('dim-generalSettingsAction'));
  assert.match(markup, /aria-describedby="[^"]+"/);
  assert.match(markup, /role="tooltip"[^>]*>帮助与反馈 · 前往 GitHub</);
  assert.match(markup, /id="dim-general-settings-trigger"/);
  assert.match(markup, /aria-label="通用设置"/);
  assert.doesNotMatch(markup, /aria-current="page"/);
  assert.match(markup, /role="tooltip"[^>]*>通用设置<\/span>/);
  const settingsButtonMarkup = markup.match(
    /<button[^>]*id="dim-general-settings-trigger"[^>]*>(.*?)<\/button>/,
  )?.[1] ?? '';
  assert.match(settingsButtonMarkup, /data-im-icon="global-settings"/);
  assert.doesNotMatch(settingsButtonMarkup, /通用设置/);
  assert.match(styles, /\.dim-title \{[^}]*margin: 0 0 18px;/);
  assert.match(styles, /\.dim-title p \{[^}]*color: var\(--dsw-alias-label-secondary, #646a73\);[^}]*font-size: 12px;[^}]*font-weight: 500;/);
  assert.match(styles, /\.dim-brand \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*align-items: flex-start;[^}]*gap: 1px;/);
  assert.match(styles, /\.dim-brandHeading \{[^}]*display: flex;[^}]*align-items: baseline;[^}]*gap: 8px;[^}]*white-space: nowrap;/);
  assert.match(styles, /\.dim-brandName \{[^}]*font-size: 20px;[^}]*font-weight: 800;[^}]*letter-spacing: \.04em;/);
  assert.match(styles, /\.dim-brandVersion \{[^}]*color: var\(--dsw-alias-label-tertiary, #8f959e\);[^}]*font: 500 10px\/16px[^}]*letter-spacing: 0;/);
  assert.doesNotMatch(styles, /dim-versionTooltip|\.dim-brand:focus-visible/);
  assert.doesNotMatch(styles, /\.dim-brandLogo/);
  assert.match(styles, /\.dim-githubLink \{[^}]*border: 1px solid var\(--dsw-alias-border-l2, #dfe1e5\);[^}]*text-decoration: none;/);
  assert.match(styles, /\.dim-githubTooltip \{[^}]*top: calc\(100% \+ 8px\);[^}]*transform: translateY\(-3px\);/);
  assert.match(styles, /\.dim-githubAction:hover \.dim-githubTooltip, \.dim-githubAction:focus-within \.dim-githubTooltip \{[^}]*opacity: 1;[^}]*visibility: visible;/);
  assert.match(styles, /\.dim-generalSettingsButton \{[^}]*width: 30px;[^}]*height: 30px;[^}]*display: grid;[^}]*border: 1px solid var\(--dsw-alias-border-l2, #dfe1e5\);/);
  assert.match(styles, /\.dim-generalSettingsTooltip \{[^}]*top: calc\(100% \+ 8px\);[^}]*transform: translateY\(-3px\);/);
  assert.match(styles, /\.dim-generalSettingsAction:hover \.dim-generalSettingsTooltip, \.dim-generalSettingsButton:focus-visible \+ \.dim-generalSettingsTooltip \{[^}]*opacity: 1;[^}]*visibility: visible;/);
  assert.match(styles, /\.dim-generalSettingsButton\[aria-current="page"\] \+ \.dim-generalSettingsTooltip \{[^}]*opacity: 0;[^}]*visibility: hidden;/);
  assert.doesNotMatch(styles, /\.dim-generalSettingsAction:focus-within \.dim-generalSettingsTooltip/);
  assert.match(styles, /\.dim-globalTtlTooltip \{[^}]*position: absolute;[^}]*opacity: 0;[^}]*visibility: hidden;/);
  assert.match(styles, /\.dim-globalTtlHelp:hover \.dim-globalTtlTooltip, \.dim-globalTtlHelpButton:focus-visible \+ \.dim-globalTtlTooltip \{[^}]*opacity: 1;[^}]*visibility: visible;/);
  assert.doesNotMatch(styles, /\.dim-globalTtlHelp:focus-within \.dim-globalTtlTooltip/);
  assert.match(styles, /\.dim-globalSweepAction \{[^}]*position: relative;[^}]*margin-left: auto;/);
  assert.match(styles, /\.dim-globalSweepConfirm \{[^}]*position: absolute;[^}]*top: calc\(100% \+ 8px\);[^}]*right: 0;/);
  assert.doesNotMatch(markup, /\d+ 个渠道|dim-channelCount/);
  assert.match(markup, />QQ</);
  assert.match(markup, /dim-logoQq/);
  assert.doesNotMatch(markup, /dim-logoSlack/);
  assert.doesNotMatch(markup, /dim-logoTelegram/);
  assert.doesNotMatch(markup, /dim-logoDiscord/);
  assert.doesNotMatch(markup, /dim-logoWhatsapp/);
  assert.doesNotMatch(markup, /dim-logoIMessage/);
  assert.doesNotMatch(markup, /dim-logoMatrix/);
  assert.doesNotMatch(markup, /dim-logoOffice/);
  assert.match(styles, /\.dim-logoFeishu svg \{ width: 28px; height: 28px; \}/);
  // The fork exposes exactly one QQ channel tab.
  assert.equal((markup.match(/role="tab"/g) ?? []).length, 1);
  assert.equal((markup.match(/aria-selected="true"/g) ?? []).length, 1);
  assert.doesNotMatch(markup, /role="switch"|type="checkbox"/);
  assert.doesNotMatch(markup, /dim-chevron|扫码绑定<\/small>|扫码接入<\/small>/);
  assert.doesNotMatch(markup, />INSTANT MESSAGING<|>Channel<|>微信设置</);
});

test('the general settings gear sits to the right of GitHub and outside the channel rail', () => {
  const markup = renderToStaticMarkup(React.createElement(IMSettingsTab, {
    globalSettingsRpcCall: async () => ({ ok: true, value: { ttlHours: 0 } }),
    weixinRpcCall: async () => ({ ok: true, value: {} }),
  }));

  assert.match(markup, /id="dim-general-settings-trigger"/);
  assert.match(markup, /aria-controls="dim-panel-global-settings"/);
  assert.match(markup, /class="dim-generalSettingsAction"/);
  assert.match(markup, /data-im-icon="global-settings"/);
  assert.ok(markup.indexOf('dim-githubAction') < markup.indexOf('dim-generalSettingsAction'));
  assert.ok(markup.indexOf('dim-generalSettingsAction') < markup.indexOf('dim-layout'));
  assert.doesNotMatch(markup, /id="dim-tab-global-settings"/);
  assert.doesNotMatch(markup, /dim-channelGlobal|dim-logoGlobal/);
  assert.match(markup, /aria-label="IM 设置导航"/);
  // The general panel only mounts once its header action is selected; the
  // action must not steal the initial selection from the first channel.
  assert.doesNotMatch(markup, /id="dim-panel-global-settings"/);
});

test('general settings defaults to group history and keeps Attachments and Delivery tabs', () => {
  const markup = renderToStaticMarkup(React.createElement(GlobalSettingsPanel, { rpcCall: async () => ({}) }));
  assert.match(markup, /<h2>通用设置<\/h2>/);
  assert.match(markup, /id="dim-general-settings-tab-general"[^>]*aria-selected="true"/);
  assert.match(markup, /id="dim-general-settings-tab-attachments"[^>]*aria-selected="false"/);
  assert.match(markup, /id="dim-general-settings-tab-delivery"[^>]*aria-selected="false"/);
  assert.equal((markup.match(/role="tab"/g) ?? []).length, 3);
  assert.match(markup, /群聊天记录保留天数/);
  assert.match(markup, /value="14"/);
  assert.match(markup, /正在读取群记录设置/);
});

test('the sweep action opens a separate confirmation popover and supports cancel', async () => {
  const calls = [];
  const rpcCall = async (endpoint, payload) => {
    calls.push({ endpoint, payload });
    if (endpoint === 'settings.inbound-ttl.get') return { ok: true, value: { ttlHours: 24 } };
    if (endpoint === 'settings.inbound-ttl.sweep') {
      return { ok: true, value: { deletedDirectories: 2, sweptWorkspaces: 5 } };
    }
    throw new Error(`unexpected endpoint: ${endpoint}`);
  };

  let renderer;
  await act(async () => {
    renderer = create(React.createElement(GlobalSettingsPanel, { rpcCall }));
    await flushMicrotasks();
  });
  await act(async () => {
    findButton(renderer, '附件').props.onClick();
    await flushMicrotasks();
  });

  await act(async () => {
    findButton(renderer, '清理过期附件').props.onClick();
  });
  const trigger = findButton(renderer, '清理过期附件');
  const confirmButton = findButton(renderer, '确认清理');
  const confirmDialog = renderer.root.findByProps({ role: 'alertdialog' });
  assert.equal(nodeText(trigger), '清理过期附件');
  assert.equal(trigger.props['aria-expanded'], true);
  assert.equal(confirmButton.props['data-kind'], 'danger');
  assert.equal(confirmDialog.props['aria-label'], '确认清理过期附件');
  assert.match(nodeText(confirmDialog), /确认清理当前已过期的附件？取消确认清理/);

  // Cancel closes the popover without running the sweep.
  await act(async () => {
    findButton(renderer, '取消').props.onClick();
  });
  assert.equal(renderer.root.findAllByProps({ role: 'alertdialog' }).length, 0);
  assert.equal(findButton(renderer, '清理过期附件').props['aria-expanded'], false);
  assert.equal(calls.filter((call) => call.endpoint === 'settings.inbound-ttl.sweep').length, 0);

  await act(async () => {
    findButton(renderer, '清理过期附件').props.onClick();
  });

  // Confirming still runs the sweep RPC, silently and without result text.
  await act(async () => {
    findButton(renderer, '确认清理').props.onClick();
    await flushMicrotasks();
  });
  assert.equal(calls.filter((call) => call.endpoint === 'settings.inbound-ttl.sweep').length, 1);
  assert.deepEqual(
    renderer.root.findAllByProps({ className: 'dim-globalFeedback' }),
    [],
  );
  assert.ok(findButton(renderer, '清理过期附件'));
  act(() => renderer.unmount());
});

test('the TTL input saves explicitly, preserves invalid text for correction, and disables save when unchanged', async () => {
  const calls = [];
  const rpcCall = async (endpoint, payload) => {
    calls.push({ endpoint, payload });
    if (endpoint === 'settings.inbound-ttl.get') return { ok: true, value: { ttlHours: 24 } };
    if (endpoint === 'settings.inbound-ttl.set') {
      return { ok: true, value: { ttlHours: payload.ttlHours } };
    }
    throw new Error(`unexpected endpoint: ${endpoint}`);
  };

  let renderer;
  await act(async () => {
    renderer = create(React.createElement(GlobalSettingsPanel, { rpcCall }));
    await flushMicrotasks();
  });
  await act(async () => {
    findButton(renderer, '附件').props.onClick();
    await flushMicrotasks();
  });
  const input = () => renderer.root.findByProps({ id: 'dim-globalTtlInput' });
  const form = () => renderer.root.findAllByType('form').find((form) => form.props.className === 'dim-globalTtlRow');
  const saveButton = () => findButton(renderer, '保存');
  const inlineNote = () => renderer.root.findAllByProps({ className: 'dim-globalInline' })
    .at(-1);
  assert.equal(input().props.value, '24');
  assert.equal(input().props.disabled, false);
  assert.equal(saveButton().props.disabled, true);

  // A valid changed value is not persisted until the user explicitly saves.
  await act(async () => {
    input().props.onChange({ target: { value: '48' } });
  });
  await act(async () => {
    input().props.onBlur();
  });
  assert.equal(calls.filter((call) => call.endpoint === 'settings.inbound-ttl.set').length, 0);
  assert.equal(saveButton().props.disabled, false);
  await act(async () => {
    form().props.onSubmit({ preventDefault() {} });
    await flushMicrotasks();
  });
  assert.deepEqual(calls.at(-1), { endpoint: 'settings.inbound-ttl.set', payload: { ttlHours: 48 } });
  assert.equal(input().props.value, '48');
  assert.equal(nodeText(inlineNote()), '已保存');
  assert.equal(saveButton().props.disabled, true);

  // Invalid input stays available for correction and cannot be submitted.
  await act(async () => {
    input().props.onChange({ target: { value: 'abc' } });
  });
  await act(async () => {
    input().props.onBlur();
    await flushMicrotasks();
  });
  assert.equal(calls.filter((call) => call.endpoint === 'settings.inbound-ttl.set').length, 1);
  assert.equal(input().props.value, 'abc');
  assert.equal(input().props['aria-invalid'], 'true');
  assert.equal(saveButton().props.disabled, true);
  assert.equal(nodeText(inlineNote()), '请输入 -1、0 或 1~8760 之间的整数。');

  // Restoring the saved value clears the error and keeps Save disabled.
  await act(async () => {
    input().props.onChange({ target: { value: '48' } });
  });
  await act(async () => {
    input().props.onBlur();
    await flushMicrotasks();
  });
  assert.equal(calls.filter((call) => call.endpoint === 'settings.inbound-ttl.set').length, 1);
  assert.equal(input().props['aria-invalid'], undefined);
  assert.equal(saveButton().props.disabled, true);
  act(() => renderer.unmount());
});

test('a failed explicit save keeps the input enabled with the error inline', async () => {
  const rpcCall = async (endpoint) => {
    if (endpoint === 'settings.inbound-ttl.get') return { ok: true, value: { ttlHours: 24 } };
    if (endpoint === 'settings.inbound-ttl.set') {
      return { ok: false, error: { code: 'store-unavailable', message: '无法写入设置存储。' } };
    }
    throw new Error(`unexpected endpoint: ${endpoint}`);
  };

  let renderer;
  await act(async () => {
    renderer = create(React.createElement(GlobalSettingsPanel, { rpcCall }));
    await flushMicrotasks();
  });
  await act(async () => {
    findButton(renderer, '附件').props.onClick();
    await flushMicrotasks();
  });
  const input = () => renderer.root.findByProps({ id: 'dim-globalTtlInput' });
  const form = () => renderer.root.findAllByType('form').find((form) => form.props.className === 'dim-globalTtlRow');

  await act(async () => {
    input().props.onChange({ target: { value: '72' } });
  });
  await act(async () => {
    form().props.onSubmit({ preventDefault() {} });
    await flushMicrotasks();
  });
  assert.equal(input().props.disabled, false);
  assert.equal(input().props.value, '72');
  const note = renderer.root.findAllByProps({ className: 'dim-globalInline' }).at(-1);
  assert.equal(nodeText(note), '无法写入设置存储。');
  assert.equal(note.props.role, 'alert');
  act(() => renderer.unmount());
});

test('all channel styles use the current Harness theme tokens', async () => {
  const styles = (await Promise.all([
    readFile(STYLES_URL, 'utf8'),
    readFile(FEISHU_STYLES_URL, 'utf8'),
    readFile(WEIXIN_STYLES_URL, 'utf8'),
    readFile(DINGTALK_STYLES_URL, 'utf8'),
    readFile(WECOM_STYLES_URL, 'utf8'),
  ])).join('\n');

  assert.doesNotMatch(
    styles,
    /--dsw-alias-(?:bg-body|line-border|line-divider|fill-secondary|fill-tertiary|state-warning-primary)/,
  );
  assert.match(styles, /--dsw-alias-bg-layer-1/);
  assert.match(styles, /--dsw-alias-bg-module-platform/);
  assert.match(styles, /--dsw-alias-interactive-bg-hover/);
  assert.match(styles, /--dsw-alias-border-l1/);
  assert.match(styles, /--dsw-alias-border-l2/);
  assert.match(styles, /--dim-blue: var\(--dsw-alias-state-business-primary, #3370ff\)/);
  assert.match(
    styles,
    /\.dim-channel\[aria-selected="true"\][^}]*var\(--dsw-alias-bg-layer-3/,
  );
  assert.match(
    styles,
    /\.dim-panel \.dim-qrExpired[^}]*--dsw-static-neutral-bluish-1000/,
  );
});

test('shared QR cards stay square and stack within the narrow combined-channel panel', async () => {
  const styles = await readFile(STYLES_URL, 'utf8');
  assert.match(styles, /\.dim-panel \{ min-width: 0; container-type: inline-size; \}/);
  assert.match(styles, /\.dim-panel \.dim-qrFrame \{[^}]*width: min\(270px, 100%\);[^}]*height: auto;[^}]*aspect-ratio: 1;/);
  assert.match(
    styles,
    /@container \(max-width: 680px\)[\s\S]*\.dim-panel \.ddt-qrLayout \{ grid-template-columns: minmax\(0, 1fr\); justify-items: center;/,
  );
  assert.match(styles, /\.dim-panel \.ddt-qrFrame, \.dim-panel \.ddt-countdown \{ width: min\(270px, 100%\); \}/);
  assert.match(styles, /\.dim-panel \.ddt-qrColumn \{ width: 100%; min-width: 0; \}/);
  assert.match(styles, /\.dim-panel \.ddt-qrCopy \{ width: 100%; min-width: 0; overflow-wrap: anywhere; \}/);
});




test('credential binding is a distinct secondary action beside QR binding in QQ', async () => {
  const settings = [
    ['QQ', QqSettingsTab],
  ];
  for (const [channel, Component] of settings) {
    const markup = renderToStaticMarkup(React.createElement(Component, {
      rpcCall: async () => ({ ok: true, value: {} }),
    }));
    const scanIndex = markup.indexOf('dim-scanButton');
    const credentialIndex = markup.indexOf('dim-credentialButton');
    assert.ok(scanIndex >= 0, `${channel} should render a QR button`);
    assert.ok(credentialIndex > scanIndex, `${channel} should place credential binding after QR binding`);
    assert.match(markup, /data-kind="credential"/);
    const credentialMarkup = markup.slice(credentialIndex, markup.indexOf('</button>', credentialIndex));
    assert.match(credentialMarkup, /dim-actionIcon/);
    assert.match(credentialMarkup, /手动接入/);
  }

  const styles = await readFile(STYLES_URL, 'utf8');
  assert.match(styles, /\.dim-panel \.dim-bindActions \{[^}]*flex-wrap: nowrap;/);
  assert.match(styles, /\.dim-panel \.dim-credentialButton \{[^}]*border: 1px solid #86909c;[^}]*background: var\(--dsw-alias-bg-layer-1, #fff\)/);
  assert.match(styles, /\.dim-panel \.dim-actionIcon \{[^}]*flex: 0 0 15px;/);
  assert.doesNotMatch(styles, /\.dim-panel \.dim-credentialPanel \{[^}]*border-left:/);
});


test('credential form stays compact while using a protected password input', () => {
  const markup = renderToStaticMarkup(React.createElement(CredentialBindingPanel, {
    channel: '企业微信',
    identityLabel: 'Bot ID',
    identityPlaceholder: '填写 Bot ID',
    secretLabel: 'Secret',
    secretPlaceholder: '填写 Secret',
    onSubmit() {},
    onCancel() {},
  }));
  assert.match(markup, />Bot ID</);
  assert.match(markup, /type="password"/);
  assert.match(markup, /autoComplete="new-password"/i);
  assert.match(markup, />手动接入企业微信机器人</);
  assert.doesNotMatch(markup, /已有机器人应用|Harness 会校验凭据|可见范围|受保护的凭据存储/);
  assert.doesNotMatch(markup, /value="[^"]+"/);
});

test('scan actions align left while online totals align right in QQ', async () => {
  const [imStyles, feishuStyles, weixinStyles, dingtalkStyles, wecomStyles, feishuSource, weixinSource, dingtalkSource, wecomSource] = await Promise.all([
    readFile(STYLES_URL, 'utf8'),
    readFile(FEISHU_STYLES_URL, 'utf8'),
    readFile(WEIXIN_STYLES_URL, 'utf8'),
    readFile(DINGTALK_STYLES_URL, 'utf8'),
    readFile(WECOM_STYLES_URL, 'utf8'),
    readFile(FEISHU_SOURCE_URL, 'utf8'),
    readFile(WEIXIN_SOURCE_URL, 'utf8'),
    readFile(DINGTALK_CLIENT_SOURCE_URL, 'utf8'),
    readFile(WECOM_SOURCE_URL, 'utf8'),
  ]);

  assert.match(imStyles, /\.dim-panel \.bxf-headingTools, \.dim-panel \.dxw-tools, \.dim-panel \.ddt-tools \{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\) max-content;[^}]*justify-content: stretch;/);
  assert.match(imStyles, /\.dim-panel \.dim-bindActions > button \{[^}]*min-width: 0;/);
  assert.match(imStyles, /\.dim-panel \.bxf-headingTools \.dim-scanButton,[^}]*justify-self: start;/);
  assert.match(imStyles, /\.dim-panel \.bxf-headingTools \.dim-onlineBadge,[^}]*justify-self: end;/);
  assert.match(dingtalkStyles, /\.ddt-tools \{[^}]*justify-content: space-between;/);

  const headingSource = (source) => source.slice(
    source.indexOf('function Heading'),
    source.indexOf('function LoadingView'),
  );
  const feishuHeading = headingSource(feishuSource);
  const weixinHeading = headingSource(weixinSource);
  const dingtalkHeading = headingSource(dingtalkSource);
  const wecomHeading = headingSource(wecomSource);
  assert.ok(dingtalkHeading.indexOf('扫码接入机器人') < dingtalkHeading.indexOf('ddt-badge'));

  for (const heading of [dingtalkHeading]) {
    assert.match(heading, /dim-scanButton/);
    assert.match(heading, /dim-onlineBadge/);
  }
  assert.doesNotMatch(weixinHeading, /dxw-dot/);
  assert.doesNotMatch(dingtalkHeading, /ddt-dot/);
  assert.match(imStyles, /\.dim-panel \.bxf-headingTools \.dim-scanButton,[^}]*border: 1px solid #1677ff;[^}]*border-radius: 8px;[^}]*background: #1677ff;[^}]*box-shadow: none;/);
  assert.match(imStyles, /\.dim-panel \.bxf-headingTools \.dim-onlineBadge,[^}]*border-radius: 999px;[^}]*background: var\(--dsw-alias-bg-module-platform, #f2f3f5\);[^}]*font-size: 12px;/);
});

test('channel headings omit the redundant local credential badge', () => {
  const components = [QqSettingsTab];

  for (const Component of components) {
    const markup = renderToStaticMarkup(React.createElement(Component, {
      rpcCall: async () => ({ ok: true, value: {} }),
    }));
    assert.doesNotMatch(markup, /凭据仅保存在本机/);
  }
});

test('bot list headings omit the total already shown by the online badge', async () => {
  const sources = await Promise.all([
    FEISHU_SOURCE_URL,
    WEIXIN_SOURCE_URL,
    DINGTALK_CLIENT_SOURCE_URL,
    WECOM_SOURCE_URL,
    QQ_SOURCE_URL,
  ].map((url) => readFile(url, 'utf8')));

  for (const source of sources) {
    assert.doesNotMatch(source, /length} 个/);
    assert.match(source, /ChannelListHeading/);
  }
});

test('channel connection details live in an accessible heading tooltip', async () => {
  const styles = await readFile(STYLES_URL, 'utf8');
  const markup = renderToStaticMarkup(React.createElement(ChannelListHeading, {
    className: 'dxw-listHeading',
    title: '已接入的微信账号',
    connectionLabel: 'iLink 长轮询',
  }));

  assert.match(markup, /<h3>已接入的微信账号<\/h3>/);
  assert.match(markup, /aria-label="查看消息通道说明"/);
  assert.match(markup, /role="tooltip"><span>消息通道<\/span><strong>iLink 长轮询<\/strong>/);
  assert.match(styles, /\.dim-panel \.dim-channelHelp:hover \.dim-channelTooltip, \.dim-panel \.dim-channelHelp:focus-within \.dim-channelTooltip \{[^}]*opacity: 1;[^}]*visibility: visible;/);
});

test('all channel settings states use the DingTalk page treatment', async () => {
  const [styles, feishuSource, weixinSource, dingtalkSource, wecomSource] = await Promise.all([
    readFile(STYLES_URL, 'utf8'),
    readFile(FEISHU_SOURCE_URL, 'utf8'),
    readFile(WEIXIN_SOURCE_URL, 'utf8'),
    readFile(DINGTALK_CLIENT_SOURCE_URL, 'utf8'),
    readFile(WECOM_SOURCE_URL, 'utf8'),
  ]);

  for (const Component of [QqSettingsTab]) {
    const markup = renderToStaticMarkup(React.createElement(Component, {
      rpcCall: async () => ({ ok: true, value: {} }),
    }));
    assert.match(markup, /dim-channelPage/);
    assert.match(markup, /dim-surfaceCard dim-loadingView/);
    assert.match(markup, /dim-spinner/);
  }

  for (const source of [feishuSource, weixinSource, dingtalkSource, wecomSource]) {
    for (const className of [
      'dim-channelPage',
      'dim-surfaceCard',
      'dim-loadingView',
      'dim-emptyView',
      'dim-qrLayout',
      'dim-inlineError',
      'dim-confirm',
    ]) {
      assert.match(source, new RegExp(className));
    }
  }

  assert.match(styles, /\.dim-panel \.dim-channelPage \{[^}]*flex-direction: column;[^}]*gap: 12px;/);
  assert.match(styles, /\.dim-panel \.dim-listHeading \{[^}]*margin: 0 0 6px;/);
  assert.match(styles, /\.dim-panel \.dim-botList \{[^}]*gap: 8px;/);
  assert.match(styles, /\.dim-panel \.dim-surfaceCard \{[^}]*border-radius: 14px;[^}]*box-shadow: 0 1px 2px/);
  assert.match(styles, /\.dim-panel \.dim-loadingView \{[^}]*padding: 38px;[^}]*text-align: center;/);
  assert.match(styles, /\.dim-panel \.dim-emptyView \{[^}]*grid-template-columns: minmax\(0, 1fr\) 180px;[^}]*gap: 30px;/);
  assert.match(styles, /\.dim-panel \.dim-qrLayout \{[^}]*grid-template-columns: 300px minmax\(0, 1fr\);[^}]*gap: 34px;[^}]*align-items: start;/);
  assert.match(styles, /\.dim-panel \.dim-viewActions \.bxf-button,[^}]*min-height: 34px;[^}]*border-radius: 8px;[^}]*font-size: 13px;/);
  assert.match(styles, /\.dim-panel \.dim-inlineError \{[^}]*padding: 22px;[^}]*background:/);
  assert.match(styles, /\.dim-panel \.dim-confirm \{[^}]*padding: 18px 24px;[^}]*border-top: 1px solid/);
});

test('bot cards reuse the same channel brand logos as the channel rail', () => {
  const railMarkup = renderToStaticMarkup(React.createElement(IMSettingsTab, {
    feishuRpcCall: async () => ({ ok: true, value: {} }),
    weixinRpcCall: async () => ({ ok: true, value: {} }),
    dingtalkRpcCall: async () => ({ ok: true, value: {} }),
    wecomRpcCall: async () => ({ ok: true, value: {} }),
  }));
  const accountMarkup = renderToStaticMarkup(React.createElement(QqAccountCard, {
    account: {
      botId: 'bot-weixin-card',
      state: 'connected',
      connected: true,
      bot: { name: '微信机器人', accountIdMasked: 'wxid••••1234' },
      stats: { messagesReceived: 2, messagesReplied: 2 },
      health: { summary: '长轮询运行正常', lastCheckedAt: '2026-08-15T07:30:49.000Z' },
    },
    onReconnect() {},
    onRequestRemove() {},
    onConfirmRemove() {},
    onCancelRemove() {},
  }));

  assert.match(railMarkup, /data-im-channel-logo="qq"/);
  assert.match(accountMarkup, /class="ddt-card dim-botCard"/);
  assert.match(accountMarkup, /class="ddt-avatar dim-botAvatar dqq-avatar"[^]*data-im-channel-logo="qq"/);
  assert.match(accountMarkup, /class="ddt-health dim-botHealth"/);
  assert.match(accountMarkup, /class="ddt-accountFooter dim-cardFooter"/);
  assert.match(accountMarkup, /class="dim-presetSelect"/);
  assert.doesNotMatch(accountMarkup, /dim-cardSummary|微信消息长轮询运行正常/);
  assert.equal((accountMarkup.match(/dim-cardAction(?: |")/g) ?? []).length, 2);
  assert.match(accountMarkup, /class="dim-botHealthGroup"[^]*class="dim-lastChecked"><span>最近检查<\/span>/);
  assert.doesNotMatch(accountMarkup, /消息通道|dim-botMetric/);
  assert.doesNotMatch(accountMarkup, /收到 \/ 回复/);
});




test('all IM channel cards keep localized actions visible above full-width feedback', async () => {
  const [imStyles, feishuStyles, weixinStyles, dingtalkStyles] = await Promise.all([
    readFile(STYLES_URL, 'utf8'),
    readFile(FEISHU_STYLES_URL, 'utf8'),
    readFile(WEIXIN_STYLES_URL, 'utf8'),
    readFile(DINGTALK_STYLES_URL, 'utf8'),
  ]);

  assert.match(dingtalkStyles, /\.ddt-accountFooter \.ddt-actions \{[^}]*flex-wrap: nowrap;/);
  assert.match(imStyles, /\.dim-panel \.dim-cardFooter \{[^}]*gap: 12px;[^}]*padding-top: 6px;[^}]*border-top: 1px solid/);
  assert.match(imStyles, /\.dim-panel \.dim-cardFooterLayout \{[^}]*width: 100%;[^}]*flex-direction: column;[^}]*align-items: stretch;/);
  assert.match(imStyles, /\.dim-panel \.dim-cardFooterLayout > \.dim-cardActions \{[^}]*align-self: stretch;/);
  assert.match(imStyles, /\.dim-panel \.dim-cardActions \{[^}]*width: 100%;[^}]*justify-content: flex-end;[^}]*flex-wrap: wrap;/);
  assert.match(imStyles, /\.dim-panel \.dim-cardFeedback \{[^}]*width: 100%;[^}]*overflow-wrap: anywhere;[^}]*white-space: normal;/);
  assert.match(imStyles, /\.dim-panel \.dim-cardActions \.dim-cardAction \{[^}]*min-height: 32px;[^}]*border-radius: 8px;[^}]*font-size: 13px;/);
  assert.match(imStyles, /\.dim-panel \.dim-cardActions \.dim-cardAction\[data-kind="danger"\] \{[^}]*#d54941/);

  const account = {
    botId: 'footer-layout-bot',
    connected: true,
    configured: true,
    state: 'connected',
    groupResponseMode: 'mention',
    bot: {
      name: '布局测试机器人',
      username: 'layout_bot',
      appIdMasked: 'cli_test••••1234',
      accountIdMasked: 'wx_test••••1234',
      clientIdMasked: 'ding_test••••1234',
      idMasked: 'bot_test••••1234',
    },
    health: { summary: '连接运行正常', lastCheckedAt: Date.now() },
    error: null,
  };
  const callbacks = {
    onReconnect() {},
    onRequestRemove() {},
    onConfirmRemove() {},
    onCancelRemove() {},
  };
  const notice = '测试消息已发送，请到对应机器人会话中确认。';
  const cards = [
    ['QQ', QqAccountCard, { account, feedback: notice }],
  ];

  for (const [channel, Card, props] of cards) {
    const markup = renderToStaticMarkup(React.createElement(Card, { ...callbacks, ...props }));
    assert.match(markup, /class="dim-cardFooterLayout"><div class="[^"]*dim-cardActions[^"]*">[^]*?<\/div><div class="[^"]*dim-cardFeedback[^"]*" role="status"/, channel);
    assert.ok(markup.indexOf('dim-cardActions') < markup.indexOf('dim-cardFeedback'), channel);
  }
});

test('all channel bot cards use the DingTalk card treatment', async () => {
  const styles = await readFile(STYLES_URL, 'utf8');

  assert.match(styles, /\.dim-panel \.dim-botCard \{[^}]*border-radius: 14px;[^}]*background: var\(--dsw-alias-bg-layer-1, #fff\);[^}]*box-shadow: 0 1px 2px/);
  assert.match(styles, /\.dim-panel \.dim-botCardBody \{[^}]*padding: 12px 8px;/);
  assert.match(styles, /\.dim-panel \.dim-botCardTop \{[^}]*align-items: flex-start;[^}]*gap: 6px;/);
  assert.match(styles, /\.dim-panel \.dim-botAvatar \{[^}]*width: 38px;[^}]*height: 38px;[^}]*border-radius: 11px;/);
  assert.match(styles, /\.dim-panel \.dim-botName h3 \{[^}]*font-size: 15px;/);
  assert.match(styles, /\.dim-panel \.dim-botHealthGroup \{[^}]*display: grid;[^}]*justify-items: end;[^}]*gap: 5px;/);
  assert.match(styles, /\.dim-panel \.dim-botCard \.dim-botHealth \{[^}]*background: transparent;[^}]*font-size: 12px;[^}]*font-weight: 400;/);
  assert.match(styles, /\.dim-panel \.dim-lastChecked \{[^}]*display: inline-flex;[^}]*font-size: 11px;[^}]*white-space: nowrap;/);
  assert.doesNotMatch(styles, /\.dim-panel \.dim-botMetrics|\.dim-panel \.dim-botMetric/);
});

test('bot card status stays in the top-right corner at every responsive breakpoint', async () => {
  const styles = await readFile(STYLES_URL, 'utf8');

  assert.match(styles, /\.dim-panel \.dim-botCardTop \{[^}]*display: flex;[^}]*align-items: flex-start;[^}]*justify-content: space-between;/);
  assert.match(styles, /\.dim-panel \.dim-botIdentity \{[^}]*min-width: 0;[^}]*flex: 1 1 0;/);
  assert.match(styles, /\.dim-panel \.dim-botHealthGroup \{[^}]*flex: none;[^}]*justify-items: end;/);
  assert.doesNotMatch(styles, /\.dim-panel \.dim-botCardTop \{ flex-direction: column;/);
  assert.doesNotMatch(styles, /\.dim-panel \.dim-botHealthGroup \{ justify-items: start;/);
});

test('bot cards wrap full workspace paths without horizontal scrolling', async () => {
  const styles = await readFile(STYLES_URL, 'utf8');

  assert.match(styles, /\.dim-panel \.dim-workspace \{[^}]*grid-template-columns: minmax\(0, 1fr\) max-content;[^}]*row-gap: 4px;[^}]*margin-top: 6px;[^}]*padding: 6px 10px;/);
  assert.match(styles, /\.dim-panel \.dim-workspaceHeader \{[^}]*display: contents;/);
  assert.match(styles, /\.dim-panel \.dim-workspacePath \{[^}]*grid-column: 1 \/ -1;[^}]*grid-row: 2;[^}]*overflow: hidden;[^}]*overflow-wrap: anywhere;[^}]*white-space: normal;/);
  assert.doesNotMatch(styles, /\.dim-panel \.dim-workspacePath \{[^}]*overflow-x: auto;/);
  assert.match(styles, /\.dim-panel \.dim-workspaceEdit \{[^}]*grid-column: 2;[^}]*grid-row: 1;[^}]*white-space: nowrap;/);
});

test('bot cards keep Agent Preset guidance in a keyboard-accessible help tooltip', async () => {
  const styles = await readFile(STYLES_URL, 'utf8');

  assert.match(styles, /\.dim-panel \.dim-preset \{[^}]*grid-template-columns: minmax\(0, 1fr\) max-content;[^}]*margin-top: 6px;[^}]*padding: 6px 10px;/);
  assert.match(styles, /\.dim-panel \.dim-presetHeader \{[^}]*position: relative;[^}]*grid-column: 1 \/ -1;[^}]*display: flex;[^}]*justify-content: space-between;/);
  assert.match(styles, /\.dim-panel \.dim-presetTitle \{[^}]*display: inline-flex;[^}]*gap: 5px;[^}]*white-space: nowrap;/);
  assert.match(styles, /\.dim-panel \.dim-presetHelpButton:focus-visible \{[^}]*box-shadow:/);
  assert.match(styles, /\.dim-panel \.dim-presetTooltip \{[^}]*position: absolute;[^}]*width: min\(320px, 100%\);[^}]*white-space: normal;[^}]*opacity: 0;[^}]*visibility: hidden;[^}]*pointer-events: none;/);
  assert.match(styles, /\.dim-panel \.dim-presetHelp:hover \.dim-presetTooltip, \.dim-panel \.dim-presetHelp:focus-within \.dim-presetTooltip \{[^}]*opacity: 1;[^}]*visibility: visible;/);
  assert.match(styles, /\.dim-panel \.dim-presetSelect \{[^}]*grid-column: 1 \/ -1;[^}]*grid-row: 2;/);
  assert.match(styles, /\.dim-panel \.dim-presetError \{[^}]*grid-column: 1 \/ -1;[^}]*grid-row: 3;/);
  assert.doesNotMatch(styles, /\.dim-panel \.dim-presetHelp \{[^}]*grid-row: 3;/);
});


test('the client dictionaries have no duplicate object keys', async () => {
  // A duplicate Chinese key silently drops one of the two translations, which no
  // parity check can catch: the object only ever holds the later value.
  for (const name of ['i18n.js', 'i18n-ru.js']) {
    const source = await readFile(new URL(`../plugin-src/client/${name}`, import.meta.url), 'utf8');
    const { warnings } = await transform(source, { loader: 'js', logLevel: 'silent' });
    assert.deepEqual(
      warnings.filter((warning) => warning.id === 'duplicate-object-key'),
      [],
      name,
    );
  }
});

test('every shipped Chinese client string has an English projection', async () => {
  // Dictionary modules are the projection rather than a source of UI strings:
  // their Chinese keys are the very literals the other modules render, so
  // scanning them would ask the dictionaries to translate themselves.
  const dictionaries = new Set(['i18n.js', 'i18n-ru.js']);
  const paths = (await readdir(CLIENT_SOURCE_DIRECTORY_URL, { recursive: true }))
    .filter((path) => path.endsWith('.js') && !dictionaries.has(path));
  const sources = await Promise.all(paths.map((path) =>
    readFile(new URL(path, CLIENT_SOURCE_DIRECTORY_URL), 'utf8')));
  const strings = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g)) {
      if (/[\p{Script=Han}]/u.test(match[2])) strings.add(match[2]);
    }
  }

  setImTranslator((key) => en[key] ?? key);
  try {
    const untranslated = [...strings].filter((value) =>
      /[\p{Script=Han}]/u.test(localizeText(value)));
    assert.deepEqual(untranslated, []);
    assert.ok(strings.size > 350);
  } finally {
    setImTranslator(null);
  }
});

test('client source contains no legacy Plugins-tab settings registrations', async () => {
  const paths = (await readdir(CLIENT_SOURCE_DIRECTORY_URL, { recursive: true }))
    .filter((path) => path.endsWith('.js'));
  const sources = await Promise.all(paths.map(async (path) => ({
    path,
    source: await readFile(new URL(path, CLIENT_SOURCE_DIRECTORY_URL), 'utf8'),
  })));
  const legacy = sources
    .filter(({ source }) => source.includes('settings.plugins.tab'))
    .map(({ path }) => path);

  assert.deepEqual(legacy, []);
});

test('client registers one top-level bilingual IM settings section with a directory picker', async () => {
  const effects = [];
  const registrations = [];
  const dictionaries = [];
  const directoryCalls = [];
  const rpcCalls = [];
  const rpcCall = async (...args) => {
    rpcCalls.push(args);
    return { ok: true, value: {} };
  };
  const localeListeners = new Set();
  const ctx = {
    effect(install, label) {
      effects.push({ install, label });
      if (label === 'im-settings: client panel service') return install();
    },
    on(event, listener) {
      assert.equal(event, 'locale/change');
      localeListeners.add(listener);
      return () => localeListeners.delete(listener);
    },
    locale: {
      bind(namespace) {
        assert.equal(namespace, IM_LOCALE_NAMESPACE);
        return (key) => en[key] ?? key;
      },
      register(namespace, value) {
        dictionaries.push({ namespace, value });
        return () => {};
      },
      getLocale() {
        return { active: 'en', locales: [], revision: 1 };
      },
    },
    connection: { rpc: { call: rpcCall } },
    workspaces: {
      async listDirectory(path, signal) {
        directoryCalls.push({ operation: 'list', path, signal });
        return { path, entries: [] };
      },
      async pickDirectory() {
        directoryCalls.push({ operation: 'pick' });
        return '/workspace/chosen';
      },
    },
    slots: {
      inject(name, install) {
        assert.equal(name, 'settings.section');
        return install();
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };

  try {
    applyClient(ctx);
    const dictionaryEffect = effects.find((entry) => entry.label === 'im-settings: bilingual dictionaries');
    assert.ok(dictionaryEffect);
    dictionaryEffect.install();

    assert.deepEqual(clientInject, ['slots', 'connection', 'locale', 'workspaces']);
    assert.equal(dictionaries[0].namespace, IM_LOCALE_NAMESPACE);
    assert.deepEqual(Object.keys(dictionaries[0].value.en).sort(), Object.keys(dictionaries[0].value.zh).sort());
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].options.name, 'settings.section');
    assert.equal(registrations[0].options.id, 'ryn-mic-dsh-qq');
    assert.equal(registrations[0].options.order, 21);
    assert.equal(registrations[0].options.locale, IM_LOCALE_NAMESPACE);
    assert.equal(registrations[0].options.label(), 'QQ bot');
    assert.equal(typeof registrations[0].component, 'function');

    const injected = registrations[0].options.inject();
    const signal = new AbortController().signal;
    await injected.globalSettingsRpcCall('settings.inbound-ttl.get', {}, signal);
    await injected.qqRpcCall('connection.status', {}, signal);
    assert.deepEqual(rpcCalls, [
      ['/api', `dsh-im${GLOBAL_SETTINGS_RPC_CHANNEL}`, { method: 'settings.inbound-ttl.get', payload: {} }, signal],
      ['/api', 'dsh-im/qq', { method: 'connection.status', payload: {} }, signal],
    ]);
    assert.deepEqual(
      await injected.workspaceDirectoryPicker.listDirectory('/workspace/current', signal),
      { path: '/workspace/current', entries: [] },
    );
    assert.equal(await injected.workspaceDirectoryPicker.pickDirectory(), '/workspace/chosen');
    assert.deepEqual(directoryCalls, [
      { operation: 'list', path: '/workspace/current', signal },
      { operation: 'pick' },
    ]);

    const markup = renderToStaticMarkup(React.createElement(
      registrations[0].component,
      injected,
    ));
    // A browser-derived interface locale reaches the Host only through this
    // mirror, so the settings section must report it while it is mounted.
    const mirrorEffect = effects.find((entry) =>
      entry.label === 'im-settings: mirror the DSH interface language');
    assert.ok(mirrorEffect, 'the interface language mirror is installed');
    const before = rpcCalls.length;
    const disposeMirror = mirrorEffect.install();
    assert.deepEqual(rpcCalls.slice(before), [
      ['/api', `dsh-im${HOST_LANGUAGE_RPC_CHANNEL}`, {
        method: HOST_LANGUAGE_ENDPOINTS.mirror, payload: { locale: 'en' },
      }, undefined],
    ]);
    assert.equal(localeListeners.size, 1);
    disposeMirror();
    assert.equal(localeListeners.size, 0);

    assert.match(markup, /Connecting DeepSeek Harness/);
    assert.match(markup, new RegExp(
      `class="dim-brandVersion">v${IM_PLUGIN_VERSION.replaceAll('.', '\\.')}<\\/span>`,
    ));
    assert.match(markup, /Help &amp; feedback · Open GitHub/);
    assert.match(markup, /General settings/);
    assert.match(markup, />QQ</);
    assert.doesNotMatch(markup, /[\p{Script=Han}]/u);
  } finally {
    setImTranslator(null);
  }
});

test('client directory picker uses the current DSH uiWorkspace service', async () => {
  const registrations = [];
  const directoryCalls = [];
  let uiWorkspace;
  const ctx = {
    effect(install, label) {
      if (label === 'im-settings: client panel service') return install();
    },
    get(name) {
      assert.equal(name, 'uiWorkspace');
      return uiWorkspace;
    },
    locale: {
      bind: () => (key) => key,
      register: () => () => {},
    },
    connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
    workspaces: {
      list: {
        getSnapshot: () => ({ items: [] }),
        subscribe: () => () => {},
      },
    },
    slots: {
      inject(name, install) {
        assert.equal(name, 'settings.section');
        return install();
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };

  try {
    applyClient(ctx);
    uiWorkspace = {
      async listDirectory(path, signal) {
        directoryCalls.push({ operation: 'list', path, signal });
        return { path, entries: [] };
      },
      async pickDirectory() {
        directoryCalls.push({ operation: 'pick' });
        return '/workspace/current-host';
      },
    };

    const injected = registrations[0].options.inject();
    const signal = new AbortController().signal;
    assert.deepEqual(
      await injected.workspaceDirectoryPicker.listDirectory('/workspace/current', signal),
      { path: '/workspace/current', entries: [] },
    );
    assert.equal(
      await injected.workspaceDirectoryPicker.pickDirectory(),
      '/workspace/current-host',
    );
    assert.deepEqual(directoryCalls, [
      { operation: 'list', path: '/workspace/current', signal },
      { operation: 'pick' },
    ]);
  } finally {
    setImTranslator(null);
  }
});

test('QQ settings and connected cards render English copy', () => {
  const rpcCall = async () => ({ ok: true, value: {} });
  const noop = () => {};
  const account = {
    botId: 'bot-english',
    state: 'connected',
    connected: true,
    bot: {
      name: 'Demo Bot',
      accountIdMasked: 'account••01',
      appIdMasked: 'app••01',
      clientIdMasked: 'client••01',
      idMasked: 'bot••01',
      username: 'demo_bot',
    },
    health: { summary: 'Connection is healthy', lastCheckedAt: '2026-08-16T08:00:00.000Z' },
  };

  setImTranslator((key) => en[key] ?? key);
  try {
    const globalMarkup = renderToStaticMarkup(React.createElement(GlobalSettingsPanel, {
      rpcCall: async () => ({ ok: true, value: { ttlHours: 24 } }),
    }));
    assert.match(globalMarkup, /General settings/);
    assert.match(globalMarkup, />Attachments<\/button>/);
    assert.match(globalMarkup, /Group chat retention \(days\)/);
    assert.match(globalMarkup, /Loading group history settings…/);
    assert.doesNotMatch(globalMarkup, /[\p{Script=Han}]/u);

    const pages = [
      QqSettingsTab,
    ];
    const pageMarkup = pages.map((Component) =>
      renderToStaticMarkup(React.createElement(Component, { rpcCall }))).join('\n');
    assert.match(pageMarkup, /Scan QR code/);
    assert.match(pageMarkup, /Manual setup/);
    assert.match(pageMarkup, /Loading QQ bot status/);
    assert.doesNotMatch(pageMarkup, /[\p{Script=Han}]/u);

    const sharedCardProps = {
      removing: true,
      onReconnect: noop,
      onRequestRemove: noop,
      onConfirmRemove: noop,
      onCancelRemove: noop,
    };
    const cards = [
      React.createElement(QqAccountCard, { ...sharedCardProps, account }),
    ];
    const cardMarkup = cards.map(renderToStaticMarkup).join('\n');
    assert.match(cardMarkup, /Connected/);
    assert.doesNotMatch(cardMarkup, /Message channel/);
    assert.match(cardMarkup, /Last checked/);
    assert.match(cardMarkup, /Check connection/);
    assert.match(cardMarkup, /Remove connection/);
    assert.doesNotMatch(cardMarkup, /[\p{Script=Han}]/u);

    const qqRetryMarkup = renderToStaticMarkup(React.createElement(QqAccountCard, {
      ...sharedCardProps,
      removing: false,
      account: {
        ...account,
        state: 'error',
        connected: false,
        error: {
          code: 'connection-failed',
          message: 'QQ 连接未就绪，插件会自动重试。',
        },
      },
    }));
    assert.match(qqRetryMarkup, /The QQ connection is not ready; the plugin will retry automatically\./);
    assert.doesNotMatch(qqRetryMarkup, /[\p{Script=Han}]/u);
  } finally {
    setImTranslator(null);
  }
});

test('QQ tab receives its RPC call from the settings render site', async () => {
  // Regression guard: the render site lists one prop per channel by hand. When
  // a new channel was added to the tab list but not to that list, its settings
  // page mounted without an RPC call and rendered "missing RPC connection".
  const source = await readFile(new URL('index.js', CLIENT_SOURCE_DIRECTORY_URL), 'utf8');
  const tabIds = [...source.matchAll(/\{\s*id:\s*'([a-zA-Z]+)',\s*label:/g)].map(m => m[1]);
  assert.ok(tabIds.length === 1, `expected the channel tab list, found ${tabIds.length}`);

  // Parse the dependency block that feeds IMSettingsTab. Upstream (#231)
  // refactored the render site into a reusable panel, so the props now come
  // from `panelDependencies` rather than an inline `inject` block; this guard
  // is about the props reaching the tab, not how they are assembled.
  const renderSite = source.indexOf('h(IMSettingsTab, {');
  assert.ok(renderSite > 0, 'the IMSettingsTab render site must exist');
  const blockStart = source.lastIndexOf('const panelDependencies = {', renderSite);
  const injectStart = blockStart >= 0
    ? blockStart
    : source.lastIndexOf('inject: () => ({', renderSite);
  assert.ok(injectStart > 0, 'the settings tab dependency block must exist');
  const injectBlock = source.slice(injectStart, source.indexOf('};', injectStart));
  const providedProps = new Set(
    [...injectBlock.matchAll(/([a-zA-Z]+RpcCall)\s*,/g)].map(m => m[1]),
  );
  const missing = tabIds
    .map((id) => `${id}RpcCall`)
    .filter((name) => !providedProps.has(name));
  assert.deepEqual(missing, [], 'QQ tab must receive its RPC call prop');
});


test('the token settings tab wires the RPC bridge into the account card', async () => {
  // Regression guard: the settings tab owns the RPC bridge and passes it down
  // to each account card. When the email panel used a bridge that was never
  // threaded through, React threw "rpcCall is not defined" and the whole IM
  // settings slot rendered nothing.
  //
  // The failure was in the wiring, not in the card itself, so the wiring is
  // what this asserts: every prop the account card consumes must be supplied
  // by the render site.
  const source = await readFile(
    new URL('../plugin-src/client/channels/shared/token-channel.js', import.meta.url),
    'utf8',
  );

  const cardSignature = /function AccountCard\(\{([^}]*)\}\)/.exec(source);
  assert.ok(cardSignature, 'the account card signature must exist');
  const consumed = cardSignature[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  // Locate the render site that mounts the card.
  const renderSite = source.slice(source.indexOf('h(AccountCard, {'));
  const renderProps = renderSite.slice(0, renderSite.indexOf('})'));
  const supplied = new Set(
    [...renderProps.matchAll(/([a-zA-Z]+)\s*[:,]/g)].map((m) => m[1]),
  );

  const optional = new Set(['testNotice', 'removing']);
  const missing = consumed.filter((name) => !supplied.has(name) && !optional.has(name));
  assert.deepEqual(missing, [], 'every prop the account card reads must be passed by the render site');

  // The extra settings panels need the bridge and a way to refresh.
  assert.ok(supplied.has('rpcCall'), 'the RPC bridge must reach the account card');
  assert.ok(supplied.has('reload'), 'a refresh callback must reach the account card');
});
