# Linear Panel

Linear issues and a full agent chat beside your work. Keep planning and execution on the same screen.

A plugin for [BB](https://getbb.app).

## Highlights

- **Issues in view.** List and board views with search, filters, priorities, and due dates.
- **Act where you work.** Update issue state, priority, and due dates through BB’s Linear integration.
- **A real chat.** Choose models, start fresh chats, and use normal BB tools in the lower panel.
- **Tasks fallback.** Use built-in BB Tasks when Linear is not configured.

## Install

```sh
bb plugin install https://github.com/dillionverma/bb-plugin-linear-panel
```

Requires BB 0.43+ and a compatible Plugin SDK (see `package.json`).

## Use

Configure BB’s **Linear** plugin and bind your team. Use **Cmd/Ctrl+Shift+T** to toggle the panel and **Cmd/Ctrl+Shift+J** to focus chat.

`bb today --help` exposes task-list operations. The panel supports BB Tasks as an alternative source.

## Designed to stay responsive

Linear lists read BB’s local issue mirror. Writes go through the Linear plugin and respect its permission setting. The panel reuses BB’s ThreadChat component.

## Development

```sh
npm ci
npm run typecheck
npm test
bb plugin build .
```

Focused fixes and reproducible bug reports are welcome. Include BB version, platform, and steps to reproduce.

## Compatibility

The repository and display name are independent of BB’s persistent plugin identity. The internal ID remains `today-rail` so existing settings, stored data, CLI commands, and integrations continue to work.

## The Ultra suite

Built for getting work done across multiple threads, agents, and projects. Install only the pieces you need.

- [Ultra Sidebar](https://github.com/dillionverma/bb-plugin-ultra-sidebar) — Organize parallel work.
- [Ultra Launcher](https://github.com/dillionverma/bb-plugin-ultra-launcher) — Start the next run.
- [Ultra Topbar](https://github.com/dillionverma/bb-plugin-ultra-topbar) — Turn threads into pull requests.
- [Usage Window](https://github.com/dillionverma/bb-plugin-usage-window) — Keep account capacity in view.

## License

MIT. See [LICENSE](LICENSE).
