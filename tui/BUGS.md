# DadTodo TUI - Bug List

## Critical - App will break or produce wrong results

- [x] **Selection cursor mismatch** - `renderProjectsView` iterates unfiltered `this.tasks`, but `selectedIndex` tracks position in filtered `getVisibleTasks()`. When `hideDone` or search is active, pressing space/enter mutates the wrong task.
- [x] **Filters don't affect rendered views** - Bucket renderers (GTD, Kanban, etc.) iterate `this.buckets` directly. Sort, search, and project filter only affect `getVisibleTasks()` used for toggle/convert - the screen shows unfiltered data while mutations hit filtered data.
- [x] **Search input invisible** - `searchInput` is created but never added to the TUI render tree. User presses `/`, focus moves to it, but they can't see what they're typing.
- [x] **`parse_mode` ignored** - Wizard asks "checkboxes only / all lists / everything" but the parser ignores it completely - `parseAllFiles` always parses everything. User who picks "checkboxes only" to avoid noise gets all items anyway.
- [x] **Stale cache from weak hash** - `hashTasks` samples only 3 tasks (first, middle, last). Editing content, changing due dates, or adding tags doesn't invalidate cache. User sees stale AI categorization until task count changes.

## High - Bad UX, data risk, or silent failures

- [x] **No undo** - Space toggles done, `c` converts bullets to checkboxes - both write to disk immediately. One accidental keystroke, no recovery.
- [x] **No visual feedback on mutations** - Toggle/convert writes silently. 200ms watcher debounce before re-parse. User sees nothing happen for ~200ms with no indication anything changed.
- [x] **Watcher crashes on invalid dir** - If the user types a nonexistent directory in the wizard, it saves to config, then `watch()` throws an unhandled error and the app dies.
- [x] **No error surfacing for AI** - `prefetchAll` swallows all errors with `catch {}`. `ai_configured` in config is never checked. User gets rule-based fallback forever with no indication AI isn't working.
- [x] **Terminal state leak on exit** - `process.exit(0)` may fire before `ProcessTerminal.stop()` completes terminal restore. Watcher FSWatcher return value is discarded - never closed on exit.
- [x] **Full re-parse on every file change** - Watcher triggers `parseAllFiles` which reads every file in the directory. For large folders (340+ files), that's 340 file reads on every single save.

## Low - Polish and missing conveniences

- [x] **No help overlay** - No `?` key to show a keybinding cheat sheet. Users can't discover chat commands.
- [x] **No `G`/`gg`/PgUp/PgDn** - Only j/k for navigation. Scrolling through 50+ tasks one at a time is painful.
- [x] **No source file shown in bucket views** - GTD/Kanban/Calendar views show task content but not which file it belongs to.
- [x] **Chat history not scrollable** - Hardcoded to last 3 messages in 4 lines. Long AI responses are lost.
- [x] **No quit confirmation** - Accidental `q` kills the app instantly.
- [x] **No quick-add keyboard shortcut** - Only way to add a task is via chat ("add X to file.md"). Should have `a` or `n` key.
- [x] **Preferences not persisted** - Theme, sort, hideDone reset every launch.
- [x] **Unused variable `headerLine`** - Dead code in post-it renderer (line ~887).
- [x] **No error state for deleted watched dir** - If the folder gets deleted while running, tasks silently vanish with no explanation.
