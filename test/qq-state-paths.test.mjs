import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { getGroupHistoryStore } from '../plugin-src/host/group-history-runtime.mjs';
import { inboundTtlSettingsPath } from '../plugin-src/host/inbound-ttl-runtime.mjs';
import { interfaceLanguageSettingsPath } from '../plugin-src/host/host-language.mjs';
import { getImageInputSettingsStore } from '../src/channels/shared/image-input-settings-store.mjs';
import { DEFAULT_IMAGE_INPUT_SETTINGS } from '../src/channels/shared/image-input-policy.mjs';
import { deliverySyncSettingsPath } from '../src/channels/shared/delivery-sync-settings-store.mjs';

test('all shared QQ settings resolve below the fork directory and image settings persist there', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-qq-paths-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const config = { dshHome: home, dataDir: join(home, 'ignored-channel-override') };
  const root = join(home, 'integrations', 'dsh-qq');
  assert.equal(inboundTtlSettingsPath(config), join(root, 'settings.json'));
  assert.equal(interfaceLanguageSettingsPath(config), join(root, 'interface-language.json'));
  assert.equal(deliverySyncSettingsPath(config), join(root, 'delivery-sync-settings.json'));
  await getImageInputSettingsStore(config).set(DEFAULT_IMAGE_INPUT_SETTINGS);
  const image = JSON.parse(await readFile(join(root, 'image-input-settings.json'), 'utf8'));
  assert.deepEqual(image.imageInput, DEFAULT_IMAGE_INPUT_SETTINGS);
  await assert.rejects(access(join(home, 'integrations', 'dsh-im')), { code: 'ENOENT' });
});

test('group history creates its archive inside the fork directory and releases the runtime', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-qq-history-path-'));
  const effects = [];
  const ctx = { logger: { error() {}, warn() {} }, effect: (install) => effects.push(install()) };
  t.after(async () => {
    for (const dispose of effects.reverse()) await dispose?.();
    await rm(home, { recursive: true, force: true });
  });
  const store = getGroupHistoryStore(ctx, { dshHome: home });
  assert.equal(store.root, join(home, 'integrations', 'dsh-qq'));
  await store.start();
  await access(join(store.root, 'group-history.sqlite'));
  await assert.rejects(access(join(home, 'integrations', 'dsh-im')), { code: 'ENOENT' });
});
