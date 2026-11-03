/** Explicitly applied QQ-client menus; never installed as a connection effect. */
export function defaultQqNativeConfiguration() {
  const item = (name, send_message) => ({ name, type: 'send_message', send_message });
  return {
    menu: {
      items: [
        { name: '会话', type: 'menu', sub_menu_items: [
          item('新会话', '/new'), item('会话列表', '/sessions'),
          item('历史记录', '/history'), item('工作区', '/workspace'),
        ] },
        { name: '设置', type: 'menu', sub_menu_items: [
          item('模型选择', '/models'), item('推理等级', '/reasoninglist'),
          item('权限档位', '/permissionlist'), item('模式预设', '/presets'),
        ] },
        { name: '助手', type: 'menu', sub_menu_items: [
          item('功能菜单', '/m'), item('运行状态', '/status'),
          item('总结会话', '/compact'), item('补充指令', '/steer'), item('使用帮助', '/help'),
        ] },
      ],
    },
    panel: {
      scope: 'c2c', target_type: 'all', panel: {
        remark: 'dsh-qq default commands',
        items: [
          ['/m', '打开功能菜单'], ['/new', '开始新会话'], ['/sessions', '选择已有会话'],
          ['/workspace', '选择工作区'], ['/models', '查看可用模型'], ['/reasoning', '调整推理等级'],
          ['/preset', '选择预设'], ['/permission', '调整权限档位'], ['/stop', '停止当前任务'],
          ['/compact', '总结当前对话'], ['/status', '查看运行状态'], ['/help', '查看使用帮助'],
        ].map(([name, desc]) => ({ type: 'command', name, desc })),
      },
    },
  };
}

export const QQ_NATIVE_READ_ACTIONS = Object.freeze(['defaults', 'getMenu', 'listPanels', 'getPanel']);
export const QQ_NATIVE_WRITE_ACTIONS = Object.freeze([
  'putMenu', 'createPanel', 'updatePanel', 'deletePanel', 'updatePanelTargets',
]);
export const QQ_NATIVE_ACTIONS = Object.freeze([...QQ_NATIVE_READ_ACTIONS, ...QQ_NATIVE_WRITE_ACTIONS]);
