# QQ 扩展接口

这些端点沿用 DSH Connection 管理 RPC 的 `/qq` 渠道，不新增公网端口。
客户端 QQ 设置页通过既有 `rpcCall(endpoint, payload, signal)` 使用它们。
示例中的标识均为占位值，应替换为本机配置的 Bot ID 和 QQ OpenID。

## 交互增强设置

```json
{
  "endpoint": "bot.features.set",
  "payload": { "botId": "YOUR_BOT_ID", "streamingEnabled": true }
}
```

流式默认关闭。开启后仅普通 C2C 消息使用真实 SDK stream API；
群聊以及没有可用被动消息上下文的回复保持最终 Markdown。
设置在下一轮生效，不重启 QQ 连接。
已流出的正文前缀保留，工具前说明与最终正文可能在同一条流中显示。
保持关闭时只交付最终答案。

`/m` 菜单默认采用 QQ `type=1` 按钮回调。
回调以平台事件里的身份和聊天为准，绑定菜单 token、有效期及会话。
先限时 ACK，再处理业务；ACK 不是“业务已完成”。
ACK 使用事件体的 `d.id`，回复的 `event_id` 使用原始 Gateway 外层的 `id`，不把它们混用为 `msg_id`。
SDK 1.0.4 丢弃外层 ID，本插件在现有连接上只读保留该字段；不新建连接、不改写事件或拼接 ID。
ACK 使用运行中 SDK 的访问令牌并兼容平台的成功空正文响应，避免 ACK 成功后因 JSON 解析失败而跳过回复。
明确不支持回调按钮时，退回 `type=2` 指令按钮，再退回编号文字。

每张菜单卡保留 15 分钟，导航与翻页可反复点击；修改操作按按钮防重复执行。
打开子菜单不会使旧卡片的其他按钮失效。数字回复选择已确认发送的当前菜单，
普通消息会退出数字选择。过期或会话／工作区已变化的回调只刷新主菜单，
不会执行旧卡片中的修改操作；刷新后请重新选择。

内置回调处理器只处理本插件生成的菜单动作。
自定义 `type=1` 按钮还需要注册相应业务处理器；未知数据不会当命令执行。

## 原生菜单与指令面板

端点：`bot.native.manage`。

```json
{
  "botId": "YOUR_BOT_ID",
  "action": "getMenu",
  "args": {}
}
```

| action | args | 是否需要 confirm:true |
|---|---|---|
| `defaults` | `{}`，只返回推荐配置 | 否 |
| `getMenu` | `{}` | 否 |
| `putMenu` | `{ "menu": { "items": [] }, "expectedVersion": 1 }` | 是 |
| `listPanels` | `{ "query": { "scope": "c2c" } }` | 否 |
| `getPanel` | `{ "panelId": "p_example" }` | 否 |
| `createPanel` | `{ "panel": { "scope":"c2c", "target_type":"all", "panel":{"items":[]} } }` | 是 |
| `updatePanel` | `{ "panelId":"p_example", "panel":{"items":[]} }` | 是 |
| `deletePanel` | `{ "panelId":"p_example" }` | 是 |
| `updatePanelTargets` | `{ "panelId":"p_example", "targets":{"op":"add", "user_openids":["USER_OPENID"]} }` | 是 |

`expectedVersion` 可选。菜单保存前查询当前版本，与提供的版本不一致就停止。
菜单更新返回 `before`、`proposed`、`restore`、`after` 和是否有变更。
没有变化不会重复 PUT；写入后重新读取。安装、启动不会自动写入菜单。

菜单对所有 C2C 用户生效。指令面板可使用 `specific` 指定用户或群。
菜单和面板的指令项通常填入 QQ 输入框，不承诺客户端自动发送。

## 富消息发送

端点：`bot.rich.send`。必须提供明确的目标和 `confirm:true`。

```json
{
  "botId": "YOUR_BOT_ID",
  "target": { "scope": "c2c", "targetId": "USER_OPENID" },
  "message": { "type": "markdown", "text": "# 任务完成\n\n**结果已准备好。**" },
  "confirm": true
}
```

| message.type | 其余字段 |
|---|---|
| `text` / `markdown` | `text`，可选 `keyboard`（官方 keyboard 结构） |
| `tuwen` | `title`、`description`、HTTPS `url`、HTTPS `pic_url` |
| `image` / `file` / `voice` / `video` | `source:{"url":"https://..."}` 或 `source:{"base64":"..."}`；可选 `fileName`、`caption` |

媒体调用真实 SDK 的 image/file/voice/video 方法，不把语音和视频伪装成普通文件。
RPC 消息对象最多 2 MiB；较大媒体建议提供平台可访问的 HTTPS 资源。
Node 内部 `bridge.sendRich()` 还接受 `source.buffer`，不接受任意本地路径。
富消息不绕过 QQ 的账号权限、客户端兼容性、媒体格式或主动投递额度。

## 失败与取消

- `qq-management-outcome-unknown` / `qq-delivery-uncertain` 表示请求已发出，结果未确认。
  先读回配置或检查聊天，不要自动重发创建或发送请求。
- 未知菜单写入结果保留 `menuBackup` / `menuRestore`，设置页可下载。
- `qq-menu-version-conflict` 要求重新读取配置并确认。
- 已分发的写请求被取消，不等于远端没有执行。
- SDK 1.0.4 媒体方法不能中止全部在途上传；本插件限制等待时间，
  并将不确定结果保留为未知，不盲目降级或重发。

以上接口具有离线测试及 SDK 契约验证；真实 QQ 展示和送达需另行验收。
