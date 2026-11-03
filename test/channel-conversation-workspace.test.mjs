import { QqStateStore as StateStore } from '../src/channels/qq/state-store.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BotWorkspaceStore, createBotWorkspaceScope } from '../src/channels/shared/bot-workspace-store.mjs';
import { runWorkspaceCommand } from '../src/channels/shared/workspace-command.mjs';
import { qqMenuView } from '../src/channels/qq/qq-menu.mjs';
import { QqHarnessBridge } from '../src/channels/qq/qq-bridge.mjs';
import { directAccessPolicy } from './channels/access-policy-fixture.mjs';

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-im-channel-workspace-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspaceA = join(root, 'a');
  const workspaceB = join(root, 'b');
  await Promise.all([mkdir(workspaceA), mkdir(workspaceB)]);
  const workspaces = await new BotWorkspaceStore(join(root, 'workspaces.json'), {
    defaultWorkspace: workspaceA,
  }).load();
  const botId = 'bot_channel_workspace';
  await workspaces.ensure(botId);
  const state = await new StateStore(join(root, 'state.json')).load();
  const listedWorkspaces = [];
  const adoptedSessions = [];
  const target = {
    async ensureRunning() {},
    async listWorkspaces() { return [workspaceA, workspaceB]; },
    async listWorkspaceSessions(workspace) {
      listedWorkspaces.push(workspace);
      return {
        workspace,
        sessions: [{ sessionId: workspace === workspaceB ? 'session-B' : 'session-A', title: workspace === workspaceB ? 'Session B' : 'Session A' }],
      };
    },
    async listModels() { return { groups: [], failures: [] }; },
    async adoptWorkspaceSession(sessionId) {
      adoptedSessions.push(sessionId);
      return { sessionId, workspace: sessionId === 'session-B' ? workspaceB : workspaceA };
    },
  };
  const scope = createBotWorkspaceScope(target, { botId, workspaces, state });
  return { ...scope, workspaces, botId, workspaceA, workspaceB, listedWorkspaces, adoptedSessions };
}

function feishuMessage(messageId, text) {
  return {
    sender: { sender_type: 'user', sender_id: { open_id: 'ou_owner' } },
    message: {
      message_id: messageId, message_type: 'text', chat_type: 'p2p',
      chat_id: 'oc_chat', content: JSON.stringify({ text }),
    },
  };
}

function feishuBridge(f) {
  const sent = [];
  const sendMessage = async (request) => {
    sent.push({ type: request.data.msg_type, content: JSON.parse(request.data.content) });
    return { code: 0, data: { message_id: `card-${sent.length}` } };
  };
  const bridge = new FeishuHarnessBridge({
    client: { im: { v1: { message: { create: sendMessage, reply: sendMessage } } } },
    channel: {}, harness: f.harness, state: f.state,
    status: { messagesReceived: 0, messagesReplied: 0, messagesRejected: 0 },
    allowedSenderOpenIds: new Set(['ou_owner']),
  });
  return {
    sent,
    async send(id, text) {
      await bridge.accept(feishuMessage(id, text));
      await bridge.waitForIdle();
    },
  };
}




test('QQ menus list conversation sessions while workspace choices retain the bot default', async (t) => {
  const f = await fixture(t);
  const key = 'c2c:owner';
  await runWorkspaceCommand(`/conv ${f.workspaceB}`, f.harness, key);
  const sessions = await qqMenuView('sessions', f.harness, f.state, key);
  assert.deepEqual(f.listedWorkspaces, [f.workspaceB]);
  assert.ok(sessions.entries.some((entry) => entry.action.text === '/session session-B'));
  assert.ok(!sessions.entries.some((entry) => entry.action.text === '/session session-A'));

  await qqMenuView('main', f.harness, f.state, key);
  assert.equal(f.listedWorkspaces.at(-1), f.workspaceB);
  const choices = await qqMenuView('workspaces', f.harness, f.state, key);
  const current = choices.entries.find((entry) => entry.label.startsWith('✓ '));
  assert.equal(current.action.text, `/workspace ${f.workspaceA}`);
  assert.equal(f.harness.currentWorkspace(), f.workspaceA);
});


test('QQ rejects an actor\'s old session menu after another group actor changes /conv', async (t) => {
  const f = await fixture(t);
  const key = 'group:group-one';
  const sent = [];
  const policy = directAccessPolicy({ users: [
    { id: 'owner', canExecuteCommands: true }, { id: 'other', canExecuteCommands: true },
  ] });
  policy.getSettings().group = structuredClone(policy.getSettings().direct);
  const bridge = new QqHarnessBridge({
    bot: {
      async send(message) { sent.push(message); return { id: `reply-${sent.length}` }; },
      async sendText(_target, text) { sent.push({ content: text }); return { id: `reply-${sent.length}` }; },
    },
    ownerUserOpenid: '*', harness: f.harness, state: f.state, accessPolicy: policy,
    logger: { warn() {}, error() {} },
  });
  let sequence = 0;
  const send = async (content, senderId = 'owner') => {
    const messageId = `message-${++sequence}`;
    await bridge.accept({
      kind: 'group', groupOpenid: 'group-one', rawEventType: 'GROUP_AT_MESSAGE_CREATE',
      senderId, messageId, content,
      replyTarget: { scope: 'group', targetId: 'group-one', msgId: messageId },
    });
  };
  await send(`/conv ${f.workspaceB}`);
  await send('/m sessions');
  const menu = sent.findLast((message) => message.keyboard);
  assert.ok(menu);
  const choice = menu.keyboard.content.rows[0].buttons[0].action.data;
  await send(`/conv ${f.workspaceA}`, 'other');
  assert.equal(f.state.sessionFor(key), null);
  await send(choice);

  assert.deepEqual(f.adoptedSessions, []);
  assert.equal(f.harness.currentConversationWorkspace(key), f.workspaceA);
  assert.equal(f.state.sessionFor(key), null);
  assert.match(JSON.stringify(sent.at(-1)), /会话或工作区已变化/u);
});
