# QQ-only DSH plugin

This fork derives from xmanrui/dsh-im commit
`d2f2703dbd2d7adb73fc04b56a12460a39f282dd` under its MIT license.
The requested delivery is a GitHub fork plus an installable tarball, without
installing or connecting it to the current desktop instance.

## Package boundary

- Package: `@ryn-mic/dsh-qq`, initial version `0.1.0`, private npm package.
- Keep only the QQ channel and the shared DSH conversation, model, approval,
  permissions, artifacts and proactive-delivery services needed by QQ.
- Remove other channel runtimes, settings pages, dependencies and publishing
  automation. Preserve the `dshIm` integration contract for consumers.
- Use a distinct plugin/module identity and data directory. Never automatically
  update this fork from the upstream npm package.
- Preserve attribution, the upstream commit and MIT license.
- Do not import WorkBuddy credentials, change its connection or open a QQ
  connection during development and packaging.

## QQ interactions

- `/m` opens real QQ keyboards. Prefer native type-1 callback actions; retain
  type-2 command actions and numbered text as explicit compatibility fallbacks.
- Process SDK interaction events on this plugin's existing QQ connection.
  Validate application, scene, actor, route, menu token, expiration and current
  session/workspace before acknowledging and dispatching.
- Acknowledge accepted actions within QQ's three-second deadline. Acknowledgment
  means accepted, not completed. Failed acknowledgments do not execute business
  actions. Business results are sent to the originating chat.
- Interaction IDs are deduplication identifiers, never ordinary passive message
  IDs. Menu actions remain single-use and revalidate when executed.
- Preserve access-policy checks and the ordinary type-2 command path.

## Native menus, media and streaming

- Provide authenticated QQ management operations for global C2C menus and
  command panels, using the current bot's REST authentication.
- Management writes are explicit actions with validated schemas; installing or
  connecting a bot must not overwrite its existing cloud menu.
- Provide usable management UI with preview/read and explicit apply actions.
- Provide a reachable rich-message RPC for text/Markdown plus keyboard, tuwen
  cards, image, voice, video and file messages. Raw secrets are never returned.
- Expose optional per-bot C2C streaming, disabled by default. Group replies keep
  final Markdown. Streaming uses actual Harness text updates and the SDK stream
  API; terminal behavior distinguishes accepted data from delivered output.
- Preserve the original reliable final-answer path when streaming is disabled.

## Delivery and evidence

Build the host/client bundles, run appropriate retained QQ/shared and new
regression tests, verify package boundaries, and smoke-load the built package
from the tarball. Provide source changes on a feature branch and a reviewable
draft PR in the user's fork. Do not merge the default branch, publish to npm,
install DSH plugins or send QQ messages.

The locally discovered desktop version is 0.2.1-rc.5. Build/load checks are not
claims of a real QQ or DSH Desktop interaction acceptance test.
