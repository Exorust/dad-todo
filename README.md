# DadTodo

Terminal-first todo app that reads existing Markdown/text todo files and lets the same task list morph between Projects, GTD, Eisenhower, Kanban, Post-Its, Calendar, and Mind Map views.

The current focus is the Bun TUI in `tui/`.

## Run the TUI

```bash
cd tui
bun install
bun run start
```

Run against the included sample tasks:

```bash
cd tui
bun tui.ts --dir ../sample-todos
```

## Test

```bash
cd tui
bun test
```

