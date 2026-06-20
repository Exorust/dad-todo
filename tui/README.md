# dadtodo

Terminal todo app that reads your existing markdown/text files and morphs between 8 views. Your notes are messy and that's fine - the app fits them into whatever organizational framework you want.

## Install

Requires [Bun](https://bun.sh). Install Bun first if you don't have it:

```
curl -fsSL https://bun.sh/install | bash
```

Then install dadtodo:

```
bun install -g github:Exorust/dad-todo
dadtodo
```

## Try it first

```
dadtodo --demo
```

Launches with sample data so you can explore all views without setting anything up.

## Views

Press 1-8 to switch:

1. **Today** - overdue, due today, in progress, coming up this week
2. **Projects** - tasks grouped by source file
3. **GTD** - inbox, next actions, waiting for, someday/maybe
4. **Eisenhower** - 2x2 urgent/important matrix
5. **Kanban** - todo, in progress, blocked, done
6. **Post-Its** - color-coded sticky note clusters
7. **Calendar** - tasks by date, navigate months with [ and ]
8. **Mind Map** - tasks grouped by goals/life areas

All views show the same data. Toggle a task done in Kanban, it updates in Calendar too.

## Keyboard shortcuts

```
j/k, arrows      navigate
space/enter       toggle done
i                 edit task text inline
e                 open in $EDITOR at line
d                 delete (press twice to confirm)
m                 mark for bulk actions
a or n            quick-add task
c                 convert bullet to checkbox
u                 undo last change
/                 search (tags, dates, filenames)
Tab               chat bar
?                 help
q q               quit
```

## Chat bar

Press Tab to focus the chat bar. Natural language commands:

```
hide done / show done
sort by due date / sort by project
add "call plumber" to home.md
set due for plumber to tomorrow
tag task 3 with urgent
delete task 5
move marked to next week
summarize week
theme warm / theme cool / theme mono
create view <description>       (AI-powered custom view)
```

## What it reads

Any markdown, text, or task file:

- **Checkboxes**: `- [ ] task`, `- [x] done`, `- [/] in progress`
- **Bullets**: `- task`, `* task`
- **Numbered**: `1. task`, `2) task`
- **Metadata**: `<!-- due:2026-07-01 -->`, `<!-- tags:urgent,work -->`, `@due(2026-07-01)`, `@done`

Configure which file types and parse modes to use on first run, or with `dadtodo --reset`.

## Config

Stored at `~/.dadtodo/config.json`. Session state (last view, chat history, custom views) persists across launches.

```
dadtodo --reset        re-run setup wizard
dadtodo --dir ~/notes  override watched directory
dadtodo --demo         sample data, no setup
dadtodo --version      show version
```

## License

MIT
