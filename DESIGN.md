# DadTodo - Design Document

**Date:** 2026-06-19
**Status:** DRAFT
**Author:** Chandrahas Aroori
**Lineage:** Borrows architecture patterns from RecursiveUI

---

## What is DadTodo?

A desktop todo app that reads your existing markdown files and lets you "morph" between 7 different views of the same data. Every view switch uses AI to reinterpret scattered, unstructured notes into the target view's structure. A built-in Studio panel lets you tweak any view's appearance through natural language chat.

The core idea: your notes are messy and that's fine. The app does the work of fitting them into whatever organizational framework you feel like using right now.

## Architecture

```
dad-proj/
  app/
    src/                React 19 + Vite frontend
      views/            7 morph views (Projects, GTD, PostIt, Eisenhower, Kanban, Calendar, MindMap)
      studio/           Studio slide-over panel (chat-based view customization)
      components/       Shared UI components (TaskCard, MorphBar, etc.)
    src-tauri/          Rust backend (single window, file watcher, IPC)
  sidecar/              Bun sidecar (Pi agent sessions, AI categorization)
```

### Tech stack

| Layer | Technology | Why |
|---|---|---|
| Desktop shell | Tauri v2 | Native macOS window, filesystem access, proven in RecursiveUI |
| Frontend | React 19 + Vite | Same as RecursiveUI, fast dev cycle |
| UI library | Radix UI Themes | Same as RecursiveUI, clean professional components |
| AI runtime | Pi agent (`@earendil-works/pi-coding-agent`) | Session management, tool definitions, model-agnostic. Lifted from RecursiveUI sidecar |
| File watching | Rust `notify` crate | FSEvents on macOS, reliable recursive directory watching |
| IPC | JSON-line over stdin/stdout | Proven pattern from RecursiveUI's sidecar protocol |

### Data flow

```
Markdown files on disk (source of truth)
        |
        v
  [Rust file watcher] --event--> [React frontend]
        |                              |
        v                              v
  [Sidecar: parse markdown]     [User edits in UI]
        |                              |
        v                              v
  Task[] in memory  <----sync---->  Write back to .md
        |
        v
  [AI categorization] -- per view morph -->  View-specific buckets
        |
        v
  [Render in active view]
```

## Data model

### Source of truth: markdown files

The user picks a folder on first launch. All `.md` and `.txt` files in that folder (recursive) are scanned for tasks. The app reads AND writes these files - edits in the UI are written back, edits in a text editor are picked up by the file watcher.

### Task format

Standard markdown checkboxes are the canonical format:

```markdown
# Project name (becomes project grouping)

- [ ] Buy groceries
- [ ] Call the dentist <!-- due:2026-06-25 -->
- [x] Fix the gate <!-- done:2026-06-18 -->
- [/] Painting the shed (in progress)
```

Supported markers:
- `[ ]` - open/todo
- `[x]` - done
- `[/]` - in progress

Metadata stored as inline HTML comments (invisible in any markdown renderer):
- `<!-- due:YYYY-MM-DD -->` - due date
- `<!-- done:YYYY-MM-DD -->` - completion date (auto-added when checked off)
- `<!-- tags:tag1,tag2 -->` - user or AI-assigned tags

Plain text lines (no checkbox) under a heading are treated as notes/context, not tasks.

### AI categorization cache

When the AI categorizes tasks for a view, the mapping is stored in a sidecar file next to the todo folder:

```
~/.dadtodo/
  config.json           # watched folder path, preferences
  cache/
    categorization.json # AI categorization results per view, keyed by content hash
```

Cache is invalidated when a task's content changes (hash mismatch). This avoids re-calling the AI when switching between views you've already visited.

## The 7 morph views

Every view is a different lens on the same `Task[]` array. The AI's job is to decide where each task belongs in the target structure.

### 1. Projects

**Structure:** Tasks grouped under project headers.
**AI role:** Infer project membership for tasks that aren't under a clear heading. Cross-file grouping (tasks in different files that belong to the same project).
**Render:** Collapsible sections, one per project. Ungrouped tasks in an "Inbox" section.

### 2. GTD (Getting Things Done)

**Structure:** 5 buckets - Inbox, Next Actions, Waiting For, Someday/Maybe, Done.
**AI role:** Classify every task into one of the 5 GTD buckets based on its content, context, and urgency. "Call the dentist" is a Next Action. "Learn watercolor painting" is Someday/Maybe. "Waiting for plumber quote" is Waiting For.
**Render:** 5 columns or stacked sections with task counts.

### 3. Post-it Notes

**Structure:** Freeform spatial canvas.
**AI role:** Assign each task a color based on theme/category. Suggest initial spatial clustering (related tasks near each other).
**Render:** Draggable cards on a 2D canvas. Positions persisted in the cache file. Color-coded by AI-assigned category.

### 4. Eisenhower Matrix

**Structure:** 2x2 grid - Urgent+Important, Important+Not Urgent, Urgent+Not Important, Neither.
**AI role:** Score every task on urgency (time-sensitive?) and importance (high impact?) to place it in one of the 4 quadrants.
**Render:** 4-quadrant grid. Tasks as compact cards in each quadrant.

### 5. Kanban

**Structure:** Columns - To Do, In Progress, Done (extendable).
**AI role:** Infer status for tasks without explicit markers. "Started drafting the proposal" implies In Progress even without `[/]`. Suggest additional columns if task patterns warrant it (e.g. "Blocked").
**Render:** Draggable columns with draggable cards. Drag-to-move updates the markdown checkbox marker.

### 6. Calendar / Timeline

**Structure:** Tasks placed on a date axis.
**AI role:** Infer dates for undated tasks. "Buy groceries" might be this weekend. "Tax filing" has an implicit April deadline. Surface tasks with no inferable date in a sidebar "Undated" list.
**Render:** Monthly calendar grid with tasks on their dates. Week/month toggle.

### 7. Mind Map

**Structure:** Tasks as nodes radiating from central goal/theme nodes.
**AI role:** Identify 3-5 high-level goals or themes from all tasks. Cluster tasks as children of the most relevant goal. Detect relationships between tasks (dependencies, related efforts).
**Render:** Radial node graph. Central nodes are goals, leaf nodes are tasks. Lines show relationships.

## The Studio

A slide-over panel that opens from the right edge of the window (triggered by the paintbrush icon in the top bar). Contains a chat interface powered by Pi agent.

### What the Studio can do

**View customization** - modify how the current view looks:

- Change colors, fonts, spacing, card sizes
- Adjust column widths, grid proportions
- Toggle what fields appear on task cards (due date, tags, project name)
- Change sort order within groups
- Adjust the AI categorization ("treat 'Buy groceries' as urgent, not low priority")

**Custom view creation** - build entirely new views from a description:

- "Create a view that groups tasks by energy level"
- "Make a view that shows only tasks mentioning people"
- See the Custom View Creation section for full details

### How it works

1. User types a request: "Make the post-it cards bigger" or "Sort by due date"
2. Pi agent interprets the request and produces a view config delta
3. The delta is applied to the current view's configuration
4. View re-renders with the change
5. Config is persisted in `~/.dadtodo/view-configs/{viewName}.json`

### View config schema

Each view has a JSON config that the Studio can modify:

```typescript
interface ViewConfig {
  // Common to all views
  cardFields: string[];      // which fields show on task cards
  sortBy: string;            // sort key within groups
  sortDirection: 'asc' | 'desc';
  density: 'compact' | 'normal' | 'spacious';
  colorScheme: Record<string, string>; // category -> color overrides

  // View-specific (examples)
  kanban?: { columns: string[] };
  calendar?: { defaultView: 'week' | 'month' };
  mindmap?: { layout: 'radial' | 'tree' };
  postit?: { cardSize: 'small' | 'medium' | 'large' };
}
```

## The morph bar

A horizontal toolbar at the top of the window:

```
[Projects] [GTD] [Post-its] [Eisenhower] [Kanban] [Calendar] [Mind Map] [+ custom views...] [Studio icon]
```

- 7 built-in icon-tabs on the left, followed by any custom views, active view highlighted with the accent color
- Each icon has a tooltip with the view name
- Studio paintbrush icon on the far right
- Clicking a view triggers: AI categorization (if not cached) then crossfade transition to the new view
- The bar also shows the watched folder name and a small refresh button

## Sidecar protocol

The Bun sidecar communicates with the Tauri shell via JSON lines on stdin/stdout, same as RecursiveUI. Messages:

### Tauri -> Sidecar

```jsonc
// Parse markdown files from a directory
{ "type": "parse-files", "dir": "/path/to/todos", "reqId": 1 }

// Categorize tasks for a specific view
{ "type": "categorize", "viewName": "eisenhower", "tasks": [...], "reqId": 2 }

// Studio chat message
{ "type": "studio-chat", "message": "Make cards bigger", "viewName": "postit", "viewConfig": {...}, "reqId": 3 }

// Create/update/complete a task
{ "type": "update-task", "filePath": "...", "lineNumber": 5, "newContent": "...", "reqId": 4 }
```

### Sidecar -> Tauri

```jsonc
// Response to any request
{ "type": "response", "reqId": 1, "ok": true, "tasks": [...] }

// Categorization result
{ "type": "response", "reqId": 2, "ok": true, "buckets": { "urgent-important": [...], ... } }

// Studio config delta
{ "type": "response", "reqId": 3, "ok": true, "configDelta": { "cardSize": "large" } }

// Streaming event (studio chat thinking)
{ "type": "studio-event", "event": { "type": "message_update", "text": "..." } }
```

## First-run experience

1. App launches to a welcome screen: "Welcome to DadTodo" with the app icon
2. "Pick your todo folder" button opens a native folder picker
3. App scans the folder, parses all markdown files
4. Lands on the Projects view (the most natural default - grouped by file)
5. Top bar is visible with all 7 view icons. Tooltip hints on hover.

## Tech decisions log

| Decision | Choice | Rationale |
|---|---|---|
| Single window | Yes | Simpler for a non-technical user. Studio is a slide-over, not a separate window |
| Markdown as source of truth | Yes | Dad can keep editing in any text editor. No database migration. No lock-in |
| AI on every morph | Yes | Source material is messy and unstructured. Every view switch is a reinterpretation, not a re-sort |
| Categorization cache | JSON sidecar file | Avoids redundant AI calls. Invalidated by content hash |
| Completion timestamps | Inline HTML comments | Invisible in markdown renderers, parseable by us, no separate database |
| Visual style | Light, neutral grays, blue accent | Clean and professional. Radix UI Themes with `blue` accent, `light` appearance |
| File watcher | Rust `notify` crate | FSEvents on macOS, more reliable than Bun/Node fs.watch |
| Morph transitions | Crossfade | Simple, reliable. Animated FLIP transitions are a future enhancement |

## RecursiveUI concepts borrowed

| RecursiveUI concept | DadTodo adaptation |
|---|---|
| Tauri v2 + React + Radix stack | Identical |
| Bun sidecar with Pi agent | Identical, simpler message set |
| JSON-line IPC protocol | Identical |
| Studio chat for UI modification | Scoped to view config tweaks instead of genome mutation |
| Layout Genome (typed JSON IR) | ViewConfig per view - simpler but same idea of a diffable, persisted config |
| Identity band | Morph bar (top toolbar with view tabs) |
| Morph vocabulary | 7 named views instead of arbitrary genome mutations |
| Categorization cache | Like RecursiveUI's scorecard - derived data that avoids recomputation |

## Custom view creation

Beyond the 7 built-in views, the Studio can create entirely new views from a natural language description.

### How it works

1. User opens the Studio and says: "Create a view that groups tasks by energy level - quick wins, deep focus, low energy"
2. Pi agent generates a **view definition** - a JSON spec describing:
   - The view's name and icon
   - Its structure type (columns, grid, canvas, tree, or list)
   - The AI categorization prompt (how to bucket tasks into this view's structure)
   - Default visual config (colors, card fields, density)
3. The view definition is validated and saved to `~/.dadtodo/custom-views/{slug}.json`
4. A new icon appears in the morph bar
5. Switching to it triggers AI categorization using the view's custom prompt

### View definition schema

```typescript
interface CustomViewDefinition {
  id: string;                    // auto-generated slug
  name: string;                  // display name ("Energy Levels")
  icon: string;                  // icon identifier for the morph bar
  structureType: 'columns' | 'grid' | 'canvas' | 'tree' | 'list';
  buckets: string[];             // the categories tasks get sorted into
  categorizationPrompt: string;  // instructions for the AI on how to classify tasks
  config: ViewConfig;            // default visual config (same schema as built-in views)
}
```

### Examples of custom views

- **Energy Levels** - columns: Quick Wins, Deep Focus, Low Energy, Errands
- **By Person** - columns: one per person mentioned in tasks ("Call Dave", "Email Sarah")
- **Weekly Planner** - grid: Mon/Tue/Wed/Thu/Fri/Weekend columns, AI assigns based on urgency and type
- **Decision Log** - list: tasks that are actually decisions to make, separated from action items
- **Waiting On** - list: everything blocked on someone else, grouped by who

### Limits

- Max 10 custom views (keeps the morph bar manageable)
- Custom views can be edited, renamed, or deleted through the Studio
- The Studio can also modify a custom view's categorization prompt ("also consider deadline proximity when assigning energy level")

## Out of scope (v1)

- Multi-folder support (pick one folder)
- Sync across devices
- Mobile app
- Collaborative editing
- RecursiveUI-style evolution loop (views don't auto-evolve from usage data - that's a v2 idea)
- Recurring tasks
- Subtask nesting beyond what markdown indentation provides
