import React from "react";
import { Box, Text } from "ink";
import chalk from "chalk";
import { basename } from "node:path";
import type { Task } from "../parser.js";
import type { Buckets } from "../categorizer.js";
import type { ActiveViewName, ThemeColors } from "../types.js";
import { filterBucketIndices } from "../taskHelpers.js";

interface TaskPaneProps {
  tasks: Task[];
  visibleTasks: Task[];
  activeView: ActiveViewName;
  buckets: Buckets;
  selectedIndex: number;
  selectedIds: Set<string>;
  theme: ThemeColors;
  height: number;
  width: number;
  helpOpen: boolean;
  scrollOffset: number;
  calendarMonthOffset: number;
  onScrollChange: (offset: number) => void;
}

function TaskLine(props: {
  task: Task;
  index: number;
  selectedIndex: number;
  selectedIds: Set<string>;
  theme: ThemeColors;
  width: number;
  showSource?: boolean;
}) {
  const { task, index, selectedIndex, selectedIds, theme, showSource } = props;
  const isSelected = index === selectedIndex;
  const isMarked = selectedIds.has(task.id);

  let checkbox: string;
  if (task.sourceType === "checkbox") {
    checkbox = task.status === "done" ? chalk.green("[x]") : task.status === "in_progress" ? chalk.yellow("[/]") : theme.muted("[ ]");
  } else {
    checkbox = theme.muted(" - ");
  }

  let content = task.content;
  if (task.status === "done") content = theme.done(content);
  else if (isSelected) content = theme.selected(content);

  let meta = "";
  if (task.dueDate) {
    const overdue = new Date(task.dueDate) < new Date();
    meta += overdue ? theme.overdue(` ${task.dueDate}`) : chalk.blue(` ${task.dueDate}`);
  }
  if (task.tags.length > 0) meta += chalk.magenta(` @${task.tags.join(" @")}`);
  if (showSource) meta += chalk.dim(` ${basename(task.filePath)}`);

  const prefix = isSelected ? theme.accent("  > ") : isMarked ? chalk.green("  * ") : "    ";

  return (
    <Text wrap="truncate">
      {isSelected ? chalk.bgGray(`${prefix}${checkbox} ${content}${meta}`) : `${prefix}${checkbox} ${content}${meta}`}
    </Text>
  );
}

function getVisibleIndexMap(visibleTasks: Task[]): Map<string, number> {
  return new Map(visibleTasks.map((task, index) => [task.id, index]));
}

function calendarMonthLabel(offset: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function TaskPane(props: TaskPaneProps) {
  const { tasks, visibleTasks, activeView, buckets, selectedIndex, selectedIds, theme, height, width, helpOpen, calendarMonthOffset } = props;

  const lines: React.ReactNode[] = [];
  let selectedLineIndex = 0;

  const pushTaskLine = (task: Task, index: number, showSource = false) => {
    if (index === selectedIndex) selectedLineIndex = lines.length;
    lines.push(
      <TaskLine key={task.id + "-" + lines.length} task={task} index={index} selectedIndex={selectedIndex} selectedIds={selectedIds} theme={theme} width={width} showSource={showSource} />
    );
  };

  if (helpOpen) {
    renderHelp(lines);
  } else if (tasks.length === 0) {
    renderEmpty(lines);
  } else if (activeView.startsWith("custom:")) {
    renderBucketSections(lines, tasks, visibleTasks, buckets, selectedIndex, selectedIds, theme, width, Object.keys(buckets), {}, pushTaskLine);
  } else {
    switch (activeView) {
      case "today": renderToday(lines, visibleTasks, theme, pushTaskLine); break;
      case "projects": renderProjects(lines, visibleTasks, theme, pushTaskLine); break;
      case "gtd": renderGtd(lines, tasks, visibleTasks, buckets, selectedIndex, selectedIds, theme, width, pushTaskLine); break;
      case "eisenhower": renderEisenhower(lines, tasks, visibleTasks, buckets, selectedIndex, selectedIds, theme, width); break;
      case "kanban": renderKanban(lines, tasks, visibleTasks, buckets, selectedIndex, selectedIds, theme, width, pushTaskLine); break;
      case "postit": renderPostit(lines, tasks, visibleTasks, buckets, selectedIndex, selectedIds, theme, width); break;
      case "calendar": renderCalendar(lines, tasks, visibleTasks, buckets, selectedIndex, selectedIds, theme, width, calendarMonthOffset, pushTaskLine); break;
      case "mindmap": renderMindmap(lines, tasks, visibleTasks, buckets, selectedIndex, selectedIds, theme, width); break;
    }
  }

  // Pad
  while (lines.length < height) lines.push(<Text key={`pad-${lines.length}`}> </Text>);

  // Scroll
  let scrollOffset = props.scrollOffset;
  if (selectedLineIndex >= scrollOffset + height) {
    scrollOffset = selectedLineIndex - height + 1;
  }
  if (selectedLineIndex < scrollOffset) {
    scrollOffset = selectedLineIndex;
  }
  if (scrollOffset !== props.scrollOffset) {
    props.onScrollChange(scrollOffset);
  }

  const visible = lines.slice(scrollOffset, scrollOffset + height);

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {visible}
    </Box>
  );
}

// -- View renderers --

function renderHelp(lines: React.ReactNode[]) {
  const h = (t: string) => <Text key={lines.length} bold color="cyan">{t}</Text>;
  const l = (t: string) => <Text key={lines.length}>{t}</Text>;
  lines.push(h("  DadTodo Help"));
  lines.push(l(""));
  lines.push(l("  1-8              switch views (1=Today)"));
  lines.push(l("  9/0              switch saved custom views"));
  lines.push(l("  j/k, arrows      move selection"));
  lines.push(l("  PgUp/PgDn        jump by page"));
  lines.push(l("  gg, G            jump to top/bottom"));
  lines.push(l("  space/enter      toggle selected checkbox"));
  lines.push(l("  c                convert selected item to checkbox"));
  lines.push(l("  i                edit selected task text"));
  lines.push(l("  e                open source in $EDITOR"));
  lines.push(l("  m                mark/unmark for bulk actions"));
  lines.push(l("  d or x, d/x      confirm delete selected/marked tasks"));
  lines.push(l("  u                undo last file edit"));
  lines.push(l("  a or n           quick-add a task to current file"));
  lines.push(l("  [ and ]          calendar previous/next month"));
  lines.push(l("  /                search"));
  lines.push(l("  Tab              focus chat, PgUp/PgDn scroll chat"));
  lines.push(l("  ?                toggle this help"));
  lines.push(l("  q, q             quit"));
  lines.push(l(""));
  lines.push(<Text key="help-chat" bold>{"  Chat examples"}</Text>);
  lines.push(l('  hide done / show done'));
  lines.push(l('  sort by due date / sort by project'));
  lines.push(l('  add "call plumber" to home.md'));
  lines.push(l('  set due for plumber to tomorrow'));
  lines.push(l('  tag task 3 with urgent'));
  lines.push(l('  move marked to next week'));
  lines.push(l('  summarize week'));
}

function renderEmpty(lines: React.ReactNode[]) {
  lines.push(<Text key="e1" bold color="yellow">{"  No tasks found"}</Text>);
  lines.push(<Text key="e2">{""}</Text>);
  lines.push(<Text key="e3">{"  Press a to add a task to inbox.md."}</Text>);
  lines.push(<Text key="e4">{"  Run with --reset to choose a different folder or parse mode."}</Text>);
  lines.push(<Text key="e5">{"  Supported files include .md, .txt, .todo, and TODO/TASKS files."}</Text>);
}

function renderToday(
  lines: React.ReactNode[],
  visibleTasks: Task[],
  theme: ThemeColors,
  pushTaskLine: (task: Task, index: number, showSource?: boolean) => void,
) {
  const today = new Date().toISOString().slice(0, 10);
  const indexOf = (t: Task) => visibleTasks.indexOf(t);

  const overdue = visibleTasks.filter(t => t.dueDate && t.dueDate < today && t.status !== "done");
  const dueToday = visibleTasks.filter(t => t.dueDate === today && t.status !== "done");
  const inProgress = visibleTasks.filter(t => t.status === "in_progress" && t.dueDate !== today && !(t.dueDate && t.dueDate < today));
  const doneToday = visibleTasks.filter(t => t.doneDate === today);

  if (overdue.length > 0) {
    lines.push(<Text key="od-h" color="red">{`  Overdue (${overdue.length})`}</Text>);
    for (const t of overdue) pushTaskLine(t, indexOf(t), true);
    lines.push(<Text key="od-s">{""}</Text>);
  }
  if (dueToday.length > 0) {
    lines.push(<Text key="dt-h" bold color="green">{`  Due Today (${dueToday.length})`}</Text>);
    for (const t of dueToday) pushTaskLine(t, indexOf(t), true);
    lines.push(<Text key="dt-s">{""}</Text>);
  }
  if (inProgress.length > 0) {
    lines.push(<Text key="ip-h" bold color="yellow">{`  In Progress (${inProgress.length})`}</Text>);
    for (const t of inProgress) pushTaskLine(t, indexOf(t), true);
    lines.push(<Text key="ip-s">{""}</Text>);
  }
  if (doneToday.length > 0) {
    lines.push(<Text key="dd-h" bold dimColor>{`  Done Today (${doneToday.length})`}</Text>);
    for (const t of doneToday) pushTaskLine(t, indexOf(t), true);
    lines.push(<Text key="dd-s">{""}</Text>);
  }
  if (overdue.length === 0 && dueToday.length === 0 && inProgress.length === 0 && doneToday.length === 0) {
    lines.push(<Text key="nt-h" bold color="green">{"  Nothing urgent today!"}</Text>);
    lines.push(<Text key="nt-s">{""}</Text>);
    lines.push(<Text key="nt-t">{"  Press 2 for projects view, or a to add a task."}</Text>);
  }

  const upcoming = visibleTasks
    .filter(t => t.dueDate && t.dueDate > today && t.dueDate <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) && t.status !== "done")
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  if (upcoming.length > 0) {
    lines.push(<Text key="up-h" bold color="cyan">{`  Coming Up This Week (${upcoming.length})`}</Text>);
    for (const t of upcoming.slice(0, 10)) pushTaskLine(t, indexOf(t), true);
    if (upcoming.length > 10) lines.push(<Text key="up-m" dimColor>{`      ... ${upcoming.length - 10} more`}</Text>);
    lines.push(<Text key="up-s">{""}</Text>);
  }
}

function renderProjects(
  lines: React.ReactNode[],
  visibleTasks: Task[],
  theme: ThemeColors,
  pushTaskLine: (task: Task, index: number, showSource?: boolean) => void,
) {
  const groups = new Map<string, { task: Task; globalIdx: number }[]>();
  for (let i = 0; i < visibleTasks.length; i++) {
    const t = visibleTasks[i]!;
    const key = t.project || "Unsorted";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ task: t, globalIdx: i });
  }

  let gi = 0;
  for (const [project, entries] of groups) {
    const doneCount = entries.filter(e => e.task.status === "done").length;
    lines.push(
      <Text key={`proj-${gi++}`}>
        {theme.heading(`  ${project}`)}{theme.muted(` (${entries.length} tasks, ${doneCount} done)`)}
      </Text>
    );

    let currentHeading = "";
    for (const { task, globalIdx } of entries) {
      if (task.heading && task.heading !== currentHeading) {
        currentHeading = task.heading;
        lines.push(<Text key={`head-${gi++}`} dimColor>{`    ${currentHeading}`}</Text>);
      }
      pushTaskLine(task, globalIdx);
    }
    lines.push(<Text key={`spc-${gi++}`}>{""}</Text>);
  }
}

function renderBucketSections(
  lines: React.ReactNode[],
  tasks: Task[],
  visibleTasks: Task[],
  buckets: Buckets,
  selectedIndex: number,
  selectedIds: Set<string>,
  theme: ThemeColors,
  width: number,
  order: string[],
  colors: Record<string, string>,
  pushTaskLine: (task: Task, index: number, showSource?: boolean) => void,
) {
  const visibleIdx = getVisibleIndexMap(visibleTasks);

  const renderBucket = (key: string, color: string) => {
    const indices = buckets[key] ?? [];
    const filtered = filterBucketIndices(indices, tasks, visibleIdx);
    const label = key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    lines.push(
      <Text key={`b-${key}`} bold color={color as any}>
        {`  ${label}`}<Text dimColor>{` (${filtered.length})`}</Text>
      </Text>
    );
    for (const idx of filtered.slice(0, 20)) {
      const t = tasks[idx]!;
      pushTaskLine(t, visibleIdx.get(t.id) ?? 0, true);
    }
    if (filtered.length > 20) {
      lines.push(<Text key={`bm-${key}`} dimColor>{`      ... ${filtered.length - 20} more`}</Text>);
    }
    lines.push(<Text key={`bs-${key}`}>{""}</Text>);
  };

  for (const key of order) renderBucket(key, colors[key] ?? "yellow");
  for (const key of Object.keys(buckets)) {
    if (!order.includes(key)) renderBucket(key, "yellow");
  }
}

function renderGtd(
  lines: React.ReactNode[],
  tasks: Task[],
  visibleTasks: Task[],
  buckets: Buckets,
  selectedIndex: number,
  selectedIds: Set<string>,
  theme: ThemeColors,
  width: number,
  pushTaskLine: (task: Task, index: number, showSource?: boolean) => void,
) {
  renderBucketSections(lines, tasks, visibleTasks, buckets, selectedIndex, selectedIds, theme, width,
    ["inbox", "next_actions", "waiting_for", "someday_maybe", "done"],
    { inbox: "red", next_actions: "green", waiting_for: "yellow", someday_maybe: "blue", done: "gray" },
    pushTaskLine,
  );
}

function renderKanban(
  lines: React.ReactNode[],
  tasks: Task[],
  visibleTasks: Task[],
  buckets: Buckets,
  selectedIndex: number,
  selectedIds: Set<string>,
  theme: ThemeColors,
  width: number,
  pushTaskLine: (task: Task, index: number, showSource?: boolean) => void,
) {
  renderBucketSections(lines, tasks, visibleTasks, buckets, selectedIndex, selectedIds, theme, width,
    ["todo", "in_progress", "blocked", "done"],
    { todo: "cyan", in_progress: "yellow", blocked: "red", done: "green" },
    pushTaskLine,
  );
}

function renderEisenhower(
  lines: React.ReactNode[],
  tasks: Task[],
  visibleTasks: Task[],
  buckets: Buckets,
  selectedIndex: number,
  selectedIds: Set<string>,
  theme: ThemeColors,
  width: number,
) {
  const visibleIdx = getVisibleIndexMap(visibleTasks);
  const filterBucket = (key: string) => filterBucketIndices(buckets[key] ?? [], tasks, visibleIdx);

  const ui = filterBucket("urgent_important");
  const ini = filterBucket("important_not_urgent");
  const uni = filterBucket("urgent_not_important");
  const n = filterBucket("neither");

  const half = Math.floor(width / 2) - 2;

  lines.push(
    <Text key="eis-h">
      {chalk.dim(" ".repeat(Math.floor(half / 2)))}{chalk.bold("URGENT")}{chalk.dim(" ".repeat(Math.max(1, half - 10)))}{chalk.bold("NOT URGENT")}
    </Text>
  );

  const renderQuadrant = (left: number[], right: number[], leftLabel: string, rightLabel: string, key: string) => {
    lines.push(
      <Text key={`eq-${key}`}>
        {chalk.bold.red(`  ${leftLabel}`)}{" ".repeat(Math.max(1, half - leftLabel.length - 2))}{chalk.dim("|")}{chalk.bold.blue(` ${rightLabel}`)}
      </Text>
    );
    const maxRows = Math.max(left.length, right.length, 1);
    for (let r = 0; r < Math.min(maxRows, 8); r++) {
      const lTask = left[r] != null ? tasks[left[r]!] : null;
      const rTask = right[r] != null ? tasks[right[r]!] : null;
      const lCheck = lTask ? taskCheckbox(lTask, theme) : "";
      const rCheck = rTask ? taskCheckbox(rTask, theme) : "";
      const lContent = lTask ? `  ${lCheck} ${lTask.content.slice(0, half - 10)}` : "";
      const rContent = rTask ? ` ${rCheck} ${rTask.content.slice(0, half - 10)}` : "";
      lines.push(
        <Text key={`eqr-${key}-${r}`} wrap="truncate">
          {lContent.padEnd(half)}{chalk.dim("|")}{rContent}
        </Text>
      );
    }
  };

  renderQuadrant(ui, ini, "DO FIRST", "SCHEDULE", "top");
  lines.push(<Text key="eis-mid" dimColor>{"  " + "-".repeat(half) + "+" + "-".repeat(half)}</Text>);
  renderQuadrant(uni, n, "DELEGATE", "ELIMINATE", "bot");
  lines.push(<Text key="eis-end">{""}</Text>);
}

function renderPostit(
  lines: React.ReactNode[],
  tasks: Task[],
  visibleTasks: Task[],
  buckets: Buckets,
  selectedIndex: number,
  selectedIds: Set<string>,
  theme: ThemeColors,
  width: number,
) {
  const visibleIdx = getVisibleIndexMap(visibleTasks);
  const entries = (Object.entries(buckets) as [string, number[]][])
    .map(([k, indices]) => [k, filterBucketIndices(indices, tasks, visibleIdx)] as [string, number[]])
    .filter(([, indices]) => indices.length > 0);
  if (entries.length === 0) { lines.push(<Text key="pi-e" dimColor>{"  No tasks."}</Text>); return; }

  const noteColors = ["bgYellow", "bgGreen", "bgCyan", "bgMagenta", "bgBlue"] as const;
  const noteWidth = Math.min(20, Math.floor(width / 3) - 2);

  for (let ei = 0; ei < entries.length; ei++) {
    const [bucketName, indices] = entries[ei]!;
    const label = bucketName.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

    lines.push(<Text key={`pi-${ei}-h`} bold>{`  ${label} (${indices.length})`}</Text>);
    for (const idx of indices.slice(0, 6)) {
      const t = tasks[idx];
      if (t) {
        const taskIndex = visibleIdx.get(t.id) ?? 0;
        const marker = taskIndex === selectedIndex ? "> " : "  ";
        lines.push(<Text key={`pi-${ei}-${idx}`}>{`    ${marker}${t.content.slice(0, noteWidth)}`}</Text>);
      }
    }
    if (indices.length > 6) {
      lines.push(<Text key={`pi-${ei}-m`} dimColor>{`    +${indices.length - 6} more`}</Text>);
    }
    lines.push(<Text key={`pi-${ei}-s`}>{""}</Text>);
  }
}

function renderCalendar(
  lines: React.ReactNode[],
  tasks: Task[],
  visibleTasks: Task[],
  buckets: Buckets,
  selectedIndex: number,
  selectedIds: Set<string>,
  theme: ThemeColors,
  width: number,
  calendarMonthOffset: number,
  pushTaskLine: (task: Task, index: number, showSource?: boolean) => void,
) {
  const visibleIdx = getVisibleIndexMap(visibleTasks);
  const today = new Date().toISOString().slice(0, 10);
  const monthAnchor = new Date();
  monthAnchor.setMonth(monthAnchor.getMonth() + calendarMonthOffset, 1);
  const monthStart = monthAnchor.toISOString().slice(0, 10);
  const monthEndDate = new Date(monthAnchor);
  monthEndDate.setMonth(monthEndDate.getMonth() + 1, 0);
  const monthEnd = monthEndDate.toISOString().slice(0, 10);
  const dated: [string, number[]][] = [];
  let undated: number[] = [];

  for (const [key, indices] of Object.entries(buckets) as [string, number[]][]) {
    const filtered = filterBucketIndices(indices, tasks, visibleIdx);
    if (filtered.length === 0) continue;
    if (key === "undated") undated = filtered;
    else if (key >= monthStart && key <= monthEnd) dated.push([key, filtered]);
  }
  dated.sort((a, b) => a[0].localeCompare(b[0]));

  lines.push(<Text key="cal-h" bold color="cyan">{`  ${calendarMonthLabel(calendarMonthOffset)}`}<Text dimColor>{"  [ and ] change month"}</Text></Text>);
  lines.push(<Text key="cal-s">{""}</Text>);

  for (const [date, indices] of dated) {
    const d = new Date(date + "T00:00:00");
    const dayName = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const isToday = date === today;
    const isPast = date < today;
    lines.push(
      <Text key={`cd-${date}`} bold={isToday} color={isToday ? "green" : isPast ? "red" : "cyan"} inverse={isToday}>
        {isToday ? ` TODAY - ${dayName} ` : `  ${dayName}`}
      </Text>
    );
    for (const idx of indices.slice(0, 20)) {
      const t = tasks[idx]!;
      pushTaskLine(t, visibleIdx.get(t.id) ?? 0, true);
    }
    lines.push(<Text key={`cds-${date}`}>{""}</Text>);
  }

  if (undated.length > 0) {
    lines.push(<Text key="cal-un" dimColor>{`  Undated (${undated.length} tasks)`}</Text>);
    for (const idx of undated.slice(0, 10)) {
      const t = tasks[idx]!;
      pushTaskLine(t, visibleIdx.get(t.id) ?? 0, true);
    }
    if (undated.length > 10) lines.push(<Text key="cal-um" dimColor>{`      ... ${undated.length - 10} more`}</Text>);
  }
}

function renderMindmap(
  lines: React.ReactNode[],
  tasks: Task[],
  visibleTasks: Task[],
  buckets: Buckets,
  selectedIndex: number,
  selectedIds: Set<string>,
  theme: ThemeColors,
  width: number,
) {
  const visibleIdx = getVisibleIndexMap(visibleTasks);
  const entries = (Object.entries(buckets) as [string, number[]][])
    .map(([k, indices]) => [k, filterBucketIndices(indices, tasks, visibleIdx)] as [string, number[]])
    .filter(([, indices]) => indices.length > 0);
  if (entries.length === 0) { lines.push(<Text key="mm-e" dimColor>{"  No tasks."}</Text>); return; }

  lines.push(<Text key="mm-h" bold color="cyan">{"  Goals"}</Text>);
  for (let i = 0; i < entries.length; i++) {
    const [bucketName, indices] = entries[i]!;
    const isLast = i === entries.length - 1;
    const label = bucketName.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    const branch = isLast ? "  +---> " : "  +---> ";
    lines.push(<Text key={`mm-b-${i}`} color="yellow">{branch}<Text bold>{label}</Text><Text dimColor>{` (${indices.length})`}</Text></Text>);

    for (const idx of indices.slice(0, 8)) {
      const t = tasks[idx];
      if (t) {
        const check = taskCheckbox(t, theme);
        const taskIndex = visibleIdx.get(t.id) ?? 0;
        const sel = taskIndex === selectedIndex ? theme.selected(`> ${t.content.slice(0, width - 20)}`) : t.content.slice(0, width - 20);
        lines.push(<Text key={`mm-t-${i}-${idx}`} color="yellow">{isLast ? "       " : "  |    "}{`+-- ${check} ${sel}`}</Text>);
      }
    }
    if (indices.length > 8) {
      lines.push(<Text key={`mm-m-${i}`} dimColor>{(isLast ? "       " : "  |    ") + `+-- ... ${indices.length - 8} more`}</Text>);
    }
    if (!isLast) lines.push(<Text key={`mm-s-${i}`} color="yellow">{"  |"}</Text>);
  }
  lines.push(<Text key="mm-end">{""}</Text>);
}

function taskCheckbox(task: Task, theme: ThemeColors): string {
  if (task.sourceType === "checkbox") {
    return task.status === "done" ? chalk.green("[x]") : task.status === "in_progress" ? chalk.yellow("[/]") : theme.muted("[ ]");
  }
  return theme.muted(" - ");
}
