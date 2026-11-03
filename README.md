# DSH QQ

个人使用的 QQ-only DeepSeek Harness 插件，基于
[xmanrui/dsh-im](https://github.com/xmanrui/dsh-im) 的 MIT 代码提取。
保留 QQ 会话、模型、工作区、权限、附件与主动投递功能。
来源与修改边界见 [UPSTREAM.md](UPSTREAM.md)。

包名：`@ryn-mic/dsh-qq`。这是自用 fork，不发布到 npm。

## QQ 功能

- `/m`、`/menu` 打开按钮菜单，优先使用原生回调。
- 回调绑定聊天、操作者、菜单 token 和会话上下文；有过期与防重放检查。
- 回调不受支持时，回退为指令按钮或数字选择。
- 支持会话、模型、工作区、预设、权限档位、停止、总结和补充指令。
- 支持 Markdown、图片、文件与主动文字／Markdown 投递。
- 富消息管理接口支持带键盘的消息、图文卡片、原生语音和视频。
- QQ 设置卡片中可读取、预览、备份并显式应用原生菜单与指令面板。
- 单聊流式为实验选项，默认关闭；群聊保持最终回答。

菜单、回调、媒体和流式代码具有离线合成测试。
真实 QQ 客户端渲染、账号权限与 DSH Desktop 使用仍需安装后验收。
源码／构建检查不能代替实际消息送达。

## 安装包使用

在 DeepSeek Harness 内置终端中执行，把路径替换为收到的安装包：

```sh
dsh plugin --profile desktop add -w /absolute/path/to/ryn-mic-dsh-qq-0.1.3.tgz
```

Web 实例使用 `--profile web`。安装后重启对应 DSH 实例，打开 QQ 设置。
本包保留 `dshIm` 集成契约，因此请与原版 `@xmanrui/dsh-im` 二选一启用。

扫码或手工配置 QQ AppID／AppSecret 后，插件自己建立 QQ 接收连接。
它不会读取 WorkBuddy 凭据、修改 WorkBuddy 或接管其连接。
若要迁移同一个机器人，应先确定接收端切换方案。

安装和连接不会自动覆盖 QQ 平台已有菜单。
在机器人卡片的「QQ 交互增强」中载入推荐配置、预览后确认应用。
修改前可下载备份；指令面板新建不会覆盖其他面板。

## 管理接口

QQ management RPC 保留原有 `/qq` 渠道，新增以下端点：

| 端点 | 用途 |
|---|---|
| `bot.features.set` | 保存 `streamingEnabled`，下一轮对话生效 |
| `bot.native.manage` | 菜单／面板查询、明确写入与关联对象维护 |
| `bot.rich.send` | 向明确指定的私聊或群聊发送富消息 |

管理调用沿用 DSH 的本地管理权限。写入和发送需要 `confirm:true`。
管理响应不返回 AppSecret 或访问 token。
字段和调用示例见 [QQ_EXTENSIONS.md](QQ_EXTENSIONS.md)。

原有纯文字主动投递契约保留，见 [PROACTIVE_DELIVERY.md](PROACTIVE_DELIVERY.md)。

## 开发与打包

```sh
npm ci --ignore-scripts
npm run check
npm pack
```

要求 Node.js 22.19 或更新版本。
设置页和 Host 由本仓库构建，不需要修改 DSH 安装包。
本机发现的目标版本为 DSH Desktop 0.2.1-rc.5；真实使用验收另行记录。
