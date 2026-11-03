# Third-party notices

This personal QQ-only fork derives from [xmanrui/dsh-im](https://github.com/xmanrui/dsh-im), commit `d2f2703`. Original source remains under the MIT License in `LICENSE`. The fork retains the shared session, model, permission, and proactive-delivery components required by QQ; the other channel implementations and upstream npm updater have been removed.

QQ messaging depends on Tencent Connect's official `@tencent-connect/qqbot-nodejs` 1.0.4, whose package declares the MIT License. QQ QR binding uses the external runtime dependency `@tencent-connect/qqbot-connector` 1.2.0, whose package metadata declares `UNLICENSED`. Neither SDK's implementation is copied into this repository or bundled into `lib/index.js`; npm resolves those packages separately when installing the plugin.

QR rendering uses the external MIT-licensed `qrcode` 1.5.4 package. Optional image normalization uses the external Apache-2.0-licensed `sharp` 0.35.5 package, with its own transitive native-library notices. Development tools and all installed dependencies retain the license files shipped by their respective packages.

The QQ mark uses path data published by Simple Icons under CC0 1.0 Universal. Product names and logos remain trademarks of their respective owners. This is an independent integration and is not endorsed by Tencent, QQ, or DeepSeek.
