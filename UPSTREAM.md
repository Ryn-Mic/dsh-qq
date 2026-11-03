# Upstream attribution

This repository is a QQ-only derivative of **DSH-IM** by xmanrui:
https://github.com/xmanrui/dsh-im

The extraction starts from commit
`d2f2703dbd2d7adb73fc04b56a12460a39f282dd` (upstream package 5.9.1),
retrieved on 2026-11-03. The original MIT license and copyright notices are
preserved in `LICENSE`; third-party runtime licenses are recorded separately.

The derivative package is `@ryn-mic/dsh-qq`, maintained in
https://github.com/Ryn-Mic/dsh-qq . It keeps QQ and necessary shared DSH
infrastructure, removes the other channel runtimes and their dependencies, and
adds native QQ menu interactions, explicit menu/panel management, rich outbound
messages and optional C2C streaming.

This package has its own loader identity and data directory. It is an alternative
to, rather than a concurrently enabled copy of, the upstream multi-channel
plugin. It never auto-updates itself to the upstream npm package.

No relationship with or endorsement by Tencent, DeepSeek or the upstream author
is implied by these fork-specific changes.
