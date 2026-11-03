# DSH QQ — personal fork

`@ryn-mic/dsh-qq` is a QQ-only extraction of [xmanrui/dsh-im](https://github.com/xmanrui/dsh-im), with the original MIT license preserved. It connects a QQ bot to the user's DeepSeek Harness (DSH). This private package is for personal use and is not published to npm.

The plugin retains QQ messaging and QR/manual credential binding, shared sessions, model selection, permission controls, workspace selection, inbound images and files, group history, DS Bot binding, and proactive delivery. The settings page has one QQ channel card and the shared general settings. Other channel implementations and their SDKs have been removed. Additional QQ features are described in [QQ_EXTENSIONS.md](./QQ_EXTENSIONS.md).

## Install when ready

Use the reviewed `.tgz` artifact from this fork. This repository task does not install the plugin or connect a bot automatically.

```sh
dsh plugin --profile web add --save-exact /absolute/path/ryn-mic-dsh-qq-0.1.2.tgz
```

Alternatively, install the feature branch containing the extraction:

```sh
npx -y 'github:Ryn-Mic/dsh-qq#feat/qq-only-enhancements' install
```

Restart the DSH host and refresh its web client, then open **Settings → QQ bot**. Use the QR connection action or enter your own AppID and AppSecret in the QQ card. The secrets are saved through DSH's credential service; do not commit them to this repository.

The package identity, browser loader, Cordis patch, host plugin, settings panel, locale namespace, and CSS IDs are separate from the upstream plugin. Shared settings and group history use `DSH_HOME/integrations/dsh-qq/`. The public `dshIm` and `dshImClient` service contracts remain available to DSH integrations. The upstream npm update mechanism has been removed; future updates must come from a reviewed fork artifact or branch.

## Local checks

```sh
npm ci --ignore-scripts
npm run check
npm pack --dry-run
npm pack
```

Tests use temporary directories, fake credentials, mock transports, and local fixtures. They do not establish acceptance of a real QQ bot. The upstream declared DSH `0.2.0-rc.2` and `0.2.1-rc.2` compatible. The user's installed DSH `0.2.1-rc.5` is recorded with plugin load smoke verification pending.

See [UPSTREAM.md](./UPSTREAM.md) for the source commit and extraction scope, [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for runtime dependencies, and [LICENSE](./LICENSE) for the MIT license.
