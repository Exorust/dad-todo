# DadTodo TUI - Audit 2: Missing Features & Usability Gaps

All 20 bugs from the first audit are confirmed fixed. This audit focuses on what's missing from a feature and usability perspective.

## Resolution

Implemented. The TUI now covers the 20 items below, plus the adversarial terminal-UI review follow-ups: selected-line scrolling, visible selection in all views, visible inline edit input, status colors by severity, narrow top-bar truncation, quick-add target display, persisted/selectable custom views, functional calendar month navigation, updated help, confirmed delete, safer editor launch, and consistent extensionless file handling.

## Critical - Broken behavior users will hit

1. **Scroll offset is line-based but compared to task index** - `renderTaskPane` builds a `lines[]` array that includes headings, blank separators, and task lines. But `scrollOffset` is set by comparing against `selectedIndex` (a task count). When selectedIndex=15 and height=10, the code sets `scrollOffset = 15 - 10 + 1 = 6` and slices lines at position 6 - but task 15 might be at line 22 (due to headings/blanks). Result: the selected task scrolls off-screen while the highlight stays invisible. Affects all views with grouped sections (Projects, GTD, Kanban, Post-Its, Mindmap).

2. **Watcher ignores extensionless files** - `isTextFile()` returns true for files named `TODO`, `TASKS`, `NOTES`, etc. and `parseAllFiles` will parse them. But `startWatcher` filters by extension via `exts.has(extname(name))` - and `extname("TODO")` returns `""`, which is never in the fileTypes set. Changes to extensionless todo files are silently ignored by the watcher while being shown in the UI on launch.

3. **Status messages rendered in red regardless of type** - `renderTopBar` uses `chalk.red()` for `this.statusMessage` unconditionally. Success messages like "Added task" and "Marked done" appear red, making every action look like an error.

4. **Quick-add doesn't show target file** - The "+ add" prompt doesn't indicate which file the task will be appended to. The target is the file of the currently selected task, but there's no visible indication. User discovers where the task went only after it appears.

## High - Significant missing features

5. **No task text editing** - Can toggle status and convert to checkbox, but can't edit task content inline. Only way to rename a task is to open the source file in an external editor.

6. **No "open in editor" shortcut** - No `e` key to open the selected task's file at its line number in `$EDITOR`. Users have to manually find the file and line.

7. **No task deletion** - Can mark done but can't remove a task. No `d` or `x` key for deletion, and no chat command like "delete task 3".

8. **Search only matches content and project** - Doesn't search tags, headings, due dates, or filenames. Searching for "@urgent" or "2026-07" finds nothing even though those values exist in the data.

9. **No empty state guidance** - If the watched directory has no matching files or no parseable tasks, the app shows blank panes with no onboarding text like "No tasks found. Press `a` to add one, or check your config with `--reset`."

10. **Custom views lost on restart** - "create view X" creates a view in-session but doesn't persist the definition to config or cache. Gone after quit.

11. **g-pending has no timeout** - Pressing `g` sets `gPending = true` forever until another key is pressed. If you press `g`, walk away for 10 minutes, come back and press `g` while thinking about something else, you unexpectedly jump to top.

12. **Tab bar overflows on narrow terminals** - All 7 view tabs render unconditionally with folder name, task count, filter indicators, and status message. On terminals under ~90 columns, the bar wraps or gets cut off. No responsive abbreviation.

## Low - Polish and nice-to-haves

13. **No multi-select for bulk operations** - Can't select multiple tasks to toggle, delete, or move. Every operation is one-task-at-a-time.

14. **No tag management from TUI** - Can add tasks and set due dates via chat, but can't add or remove tags. No "tag task 3 with @urgent" command.

15. **Eisenhower view truncates at 8 items per quadrant** - `Math.min(maxRows, 8)` hardcoded. A quadrant with 20 items silently hides 12 with no scroll or indicator.

16. **Calendar view has no week/month navigation** - Shows all dated tasks in a flat chronological list. No way to jump to a specific week or collapse past dates.

17. **Chat history not persisted** - Conversation is lost on restart. No session memory.

18. **Wizard doesn't validate directory exists** - The setup wizard saves the path without checking `existsSync()`. Validation only happens at runtime in `parseConfiguredFiles()`, which just sets a status message.

19. **AI timeout hardcoded to 20s** - `categorizer.ts` has `setTimeout(() => reject(...), 20000)`. Not configurable. On slow connections, AI silently falls back to rules.

20. **Input rendering relies on prefix removal hack** - `addInput.render()` and `searchInput.render()` output is post-processed with `.replace(/^> /, "")` to strip the Input component's prompt prefix. Breaks if pi-tui changes the prefix format.
