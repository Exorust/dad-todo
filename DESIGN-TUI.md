# DadTodo TUI - Design Document

**Date:** 2026-06-20
**Status:** DRAFT
**Author:** Chandrahas Aroori
**Lineage:** Replaces the desktop (Tauri) version. Same concept, terminal-native.

---

## What is DadTodo TUI?

A terminal todo app that reads your existing markdown/text files and lets you "morph" between 7 different views of the same data. A persistent chat bar at the bottom lets you talk to Pi agent to modify views, manage tasks, or ask questions about your workload. Split-screen layout: tasks on top, chat on bottom.

The core idea: your notes are messy and that's fine. The app does the work of fitting them into whatever organizational framework you feel like using right now.

## Architecture

```
dad-proj/
  tui/
    tui.ts              Entry point + CLI (#!/usr/bin/env bun)
    app.ts              Main TUI application (pi-tui based)
    parser.ts           Markdown/text file parser (from sidecar)
    categorizer.ts      AI categorization via Pi agent (from sidecar)
    views/              View renderers (Components for each morph view)
    components/         Shared TUI components (task list, status bar, etc.)
    config.ts           Config loading/saving, first-run wizard
    watcher.ts          File watcher (Bun fs.watch)
    package.json
  app/                  Legacy Tauri desktop app (kept as subfolder)
  sample-todos/         Test data
```

### Tech stack

- **Runtime:** Bun
- **TUI framework:** pi-tui (@earendil-works/pi-tui) - same framework that powers Claude Code and Pi agent
- **AI runtime:** Pi agent (@earendil-works/pi-coding-agent)
- **File watching:** Bun fs.watch / node:fs watch
- **Language:** TypeScript

### Why pi-tui?

pi-tui provides differential rendering, component-based architecture, overlays, keyboard input routing, box-drawing, ANSI colors, Kitty image protocol, and a readline-quality Input component. It's already a dependency from Pi agent. Zero new deps.

---

## First-Run Wizard

On first launch (no `~/.dadtodo/config.json`), the TUI presents an interactive setup:

1. **"Which folder contains your todo files?"** - path input with tab completion
2. **"What file types should I look for?"** - multi-select: Markdown, Text, Taskpaper, All
3. **"Should I treat every list item as a task, or only checkboxes?"** - avoids the 15K-items-from-docs problem
4. **"Set up AI features now?"** - if no Pi auth, offer to run `pi auth` or skip

Preferences saved to `~/.dadtodo/config.json`. Subsequent launches skip the wizard.

```json
{
  "watched_dir": "/Users/dad/todos",
  "file_types": [".md", ".txt", ".todo"],
  "parse_mode": "all_lists",
  "ai_configured": true
}
```

---

## Screen Layout

```
+------------------------------------------------------------------+
| [1:Projects] [2:GTD] [3:Eisenhower] [4:Kanban] ...  | 49 tasks  |
+------------------------------------------------------------------+
|                                                                  |
|  TASK VIEW (60-70% of terminal height)                           |
|  Current view renders here. Scrollable.                          |
|  j/k or arrows to navigate, space to toggle done.               |
|                                                                  |
+------------------------------------------------------------------+
|  AI: Sorted by due date. 3 tasks are overdue.                    |
|                                                                  |
|  > type here to chat with Pi...                                  |
+------------------------------------------------------------------+
```

Three zones:
- **Top bar** - View tabs (1-7 to switch), task count, current folder name
- **Task pane** - The active view. Scrollable, keyboard-navigable. 60-70% height.
- **Chat pane** - AI response area + input box. 30-40% height. Scrollable history.

---

## Views (Terminal Rendering)

All views work at 80 columns minimum. Wide terminals get enhanced layouts.

### 1. Projects (default)
Collapsible tree grouped by file, sub-grouped by heading.
```
  home.md (10 tasks, 2 done)
  v Home
      [x] Replace smoke detector batteries
      [ ] Fix the leaking kitchen faucet
      [ ] Repaint the garden fence          2026-06-28
  > Garden (4 tasks)

  work.md (9 tasks, 1 done)
  ...
```

### 2. GTD
Horizontal columns (if terminal > 120 cols) or vertical sections.
```
  Inbox (12)           Next Actions (8)     Waiting For (3)
  ----------------     ----------------     ----------------
  [ ] Call insurance   [ ] Fix faucet       [ ] Plumber quote
  [ ] Check passport   [ ] Quarterly rpt    [ ] Bank loan
  ...                  ...                  ...
```

### 3. Eisenhower Matrix
2x2 grid using box-drawing characters.
```
           URGENT                    NOT URGENT
  +------------------------+------------------------+
  | DO FIRST (3)           | SCHEDULE (8)           |
  | [ ] Quarterly report   | [ ] Health checkup     |
  | [ ] Slides for Monday  | [ ] Anniversary dinner |
  +------------------------+------------------------+
  | DELEGATE (2)           | ELIMINATE (5)          |
  | [ ] Expense claims     | [ ] Photography course |
  +------------------------+------------------------+
```

### 4. Kanban
Same as GTD column layout with To Do / In Progress / Blocked / Done.

### 5. Post-Its
Colored blocks using ANSI background colors, wrapped in a grid.
```
  Shopping              Home Repairs          Family
  +---------------+     +---------------+     +---------------+
  | Rice 10kg     |     | Fix faucet    |     | Priya birthday|
  | Coconut oil   |     | Porch light   |     | Diwali plans  |
  | Vegetables    |     | Garden fence  |     | Chandu move   |
  +---------------+     +---------------+     +---------------+
```

### 6. Calendar
Date-sorted list with TODAY highlight.
```
  TODAY - Fri, Jun 20
    [ ] Finish the quarterly report          work.md
    [ ] Download property tax forms          quick-notes.todo

  Sat, Jun 22
    [ ] Trim the hedges                      home.md

  Sun, Jun 28
    [ ] Repaint the garden fence             home.md
  ...

  Undated (31 tasks)
    [ ] Fix the leaking kitchen faucet       home.md
    ...
```

### 7. Mind Map
Indented tree with branch characters.
```
  Goals
  +--> Home & Garden (10)
  |    +-- Fix the leaking kitchen faucet
  |    +-- Repaint the garden fence
  |    +-- Plant tomatoes this weekend
  |
  +--> Work & Career (9)
  |    +-- Quarterly report
  |    +-- Monday presentation
  |
  +--> Family & Health (8)
       +-- Book health checkup
       +-- Anniversary dinner
```

---

## Keyboard Controls

| Key | Action |
|-----|--------|
| 1-7 | Switch to view 1-7 |
| j/k or Up/Down | Navigate tasks |
| Space or Enter | Toggle task done/open |
| c | Convert list item to checkbox todo |
| / | Focus search filter |
| Tab | Toggle focus between task pane and chat pane |
| r | Reload files |
| q | Quit |
| Esc | Cancel/unfocus |

When chat pane is focused:
- Type naturally to chat with Pi
- Enter to send
- Esc to return focus to task pane
- Up/Down to scroll chat history

---

## Chat Bar (Pi Agent Integration)

The chat bar is the universal interface. Three modes of interaction:

### View commands
- "sort by due date"
- "hide done tasks"
- "show only work tasks"
- "switch to eisenhower"
- "group by file"

### Task commands
- "mark task 3 as done"
- "add 'buy milk' to shopping.md"
- "move all garden tasks to next week"
- "set due date for quarterly report to friday"

### Conversational
- "what's overdue?"
- "summarize my week"
- "what should I focus on today?"
- "how many tasks are in each project?"

Pi agent receives the full task context and the current view state. Responses appear in the chat pane. Task/file mutations happen via direct file writes, the watcher picks up changes, and the task pane refreshes automatically.

---

## Data Flow

```
Markdown files (source of truth)
       |
       v
  parser.ts (reads all matching files, extracts tasks)
       |
       v
  Task[] in memory
       |
       +------> View renderer (rule-based, instant)
       |
       +------> categorizer.ts (Pi agent AI, cached to disk)
       |              |
       |              v
       |         ~/.dadtodo/cache/{view}.json
       |
       +------> Chat handler (Pi agent session)
                     |
                     v
               File writes (task mutations)
                     |
                     v
               fs.watch triggers re-parse
```

### Caching strategy
- Rule-based fallback categorization is instant (no AI needed)
- AI categorization cached to `~/.dadtodo/cache/` per view
- Cache keyed by task content hash - invalidated when files change
- First launch: show rule-based immediately, AI refines in background
- Subsequent view switches: instant from cache

### Pagination
- Views show 20 tasks per section
- j/k scrolls through them
- "Show more" loads next 20

---

## Config

`~/.dadtodo/config.json`:
```json
{
  "watched_dir": "/path/to/todos",
  "file_types": [".md", ".txt", ".todo", ".taskpaper", ".tasks", ".list"],
  "parse_mode": "all_lists",
  "ai_configured": true
}
```

`parse_mode` options:
- `"checkboxes_only"` - only `- [ ]` / `- [x]` items
- `"all_lists"` - bullets, numbered, plain text in task files
- `"everything"` - all list items in all files (can be noisy)

---

## Implementation Plan

### Phase 1: Core TUI
1. Move parser.ts and categorizer.ts to tui/
2. Build TUI skeleton: top bar, task pane, chat pane (pi-tui)
3. First-run wizard (config questions)
4. Projects view (default, no AI needed)
5. Keyboard navigation (j/k, space, 1-7)
6. File watcher

### Phase 2: Views + AI
7. Rule-based fallback for all 6 AI views
8. AI categorization with disk cache
9. All 7 view renderers
10. Convert-to-todo (c key)

### Phase 3: Chat
11. Pi agent session for chat
12. View modification via chat
13. Task mutation via chat (file writes)
14. Conversational queries

### Phase 4: Polish
15. Search/filter (/)
16. Custom view creation via chat
17. Color themes
18. Tab completion for file paths in wizard
