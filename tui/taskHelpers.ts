import chalk from "chalk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import type { Task } from "./parser";
import type { Buckets } from "./categorizer";
import { getCacheDir } from "./config";
import type { ThemeName, ThemeColors, SortBy } from "./types";

// -- Color themes --

export const THEMES: Record<ThemeName, ThemeColors> = {
  default: {
    accent: chalk.cyan,
    heading: chalk.bold.cyan,
    selected: chalk.white.bold,
    done: chalk.strikethrough.dim,
    overdue: chalk.red,
    muted: chalk.dim,
    tab: chalk.gray,
    tabActive: chalk.bgBlue.white.bold,
  },
  warm: {
    accent: chalk.yellow,
    heading: chalk.bold.yellow,
    selected: chalk.bold.hex("#FF6B35"),
    done: chalk.strikethrough.dim,
    overdue: chalk.red,
    muted: chalk.dim,
    tab: chalk.gray,
    tabActive: chalk.bgYellow.black.bold,
  },
  cool: {
    accent: chalk.blue,
    heading: chalk.bold.blue,
    selected: chalk.bold.hex("#00D4FF"),
    done: chalk.strikethrough.dim,
    overdue: chalk.magenta,
    muted: chalk.dim,
    tab: chalk.gray,
    tabActive: chalk.bgCyan.black.bold,
  },
  mono: {
    accent: chalk.white,
    heading: chalk.bold.white,
    selected: chalk.bold.inverse,
    done: chalk.strikethrough.dim,
    overdue: chalk.underline,
    muted: chalk.dim,
    tab: chalk.dim,
    tabActive: chalk.inverse.bold,
  },
};

// -- Rule-based fallback categorization --

export function fallbackCategorize(viewName: string, tasks: Task[]): Buckets {
  const buckets: Buckets = {};
  const push = (key: string, i: number) => { (buckets[key] ??= []).push(i); };

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]!;
    switch (viewName) {
      case "gtd":
        if (t.status === "done") push("done", i);
        else if (t.tags?.includes("waiting")) push("waiting_for", i);
        else if (t.heading?.toLowerCase().includes("someday")) push("someday_maybe", i);
        else if (t.dueDate || t.status === "in_progress") push("next_actions", i);
        else push("inbox", i);
        break;
      case "eisenhower":
        if (t.dueDate) {
          const days = (new Date(t.dueDate).getTime() - Date.now()) / 86400000;
          push(days < 3 ? "urgent_important" : "important_not_urgent", i);
        } else push("neither", i);
        break;
      case "kanban":
        push(t.status === "done" ? "done" : t.status === "in_progress" ? "in_progress" : "todo", i);
        break;
      case "calendar":
        push(t.dueDate ?? "undated", i);
        break;
      case "postit":
        push(t.project || "other", i);
        break;
      case "mindmap":
        push(t.project || "general", i);
        break;
      default:
        push("all", i);
    }
  }
  return buckets;
}

// -- Disk cache --

export function hashTasks(tasks: Task[]): string {
  const key = tasks
    .map(t => `${t.id}\0${t.status}\0${t.content}\0${t.dueDate ?? ""}\0${t.doneDate ?? ""}\0${t.tags.join(",")}`)
    .join("\n");
  return createHash("sha256").update(key).digest("hex");
}

export function readCache(viewName: string): { hash: string; buckets: Buckets } | null {
  try {
    return JSON.parse(readFileSync(join(getCacheDir(), `${viewName}.json`), "utf-8"));
  } catch { return null; }
}

export function writeCache(viewName: string, hash: string, buckets: Buckets) {
  try {
    writeFileSync(join(getCacheDir(), `${viewName}.json`), JSON.stringify({ hash, buckets, timestamp: Date.now() }));
  } catch {}
}

// -- Date resolution --

export function resolveDate(input: string): string {
  const l = input.toLowerCase();
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  if (l === "today") return fmt(now);
  if (l === "tomorrow") { now.setDate(now.getDate() + 1); return fmt(now); }
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dayIdx = days.indexOf(l);
  if (dayIdx !== -1) {
    const diff = (dayIdx - now.getDay() + 7) % 7 || 7;
    now.setDate(now.getDate() + diff);
    return fmt(now);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  return input;
}

// -- Task filtering and sorting --

export function taskSearchText(task: Task): string {
  return [
    task.content,
    task.project,
    task.heading,
    task.dueDate ?? "",
    task.doneDate ?? "",
    basename(task.filePath),
    ...task.tags.map(t => `@${t}`),
    ...task.tags,
  ].join(" ").toLowerCase();
}

export function getVisibleTasks(
  tasks: Task[],
  activeView: string,
  buckets: Buckets,
  hideDone: boolean,
  projectFilter: string,
  searchFilter: string,
  sortBy: SortBy,
): Task[] {
  let list: Task[];
  if (activeView === "projects" || activeView === "today") {
    list = [...tasks];
  } else {
    const all = (Object.values(buckets) as number[][]).flat();
    list = all.map(i => tasks[i]).filter(Boolean) as Task[];
  }
  if (hideDone) list = list.filter(t => t.status !== "done");
  if (projectFilter) {
    const q = projectFilter.toLowerCase();
    list = list.filter(t => t.project.toLowerCase().includes(q));
  }
  if (searchFilter) {
    const q = searchFilter.toLowerCase();
    list = list.filter(t => taskSearchText(t).includes(q));
  }
  if (sortBy !== "default") {
    list.sort((a, b) => {
      if (sortBy === "due") return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
      if (sortBy === "status") return a.status.localeCompare(b.status);
      if (sortBy === "project") return a.project.localeCompare(b.project);
      return 0;
    });
  }
  return list;
}

// -- Bucket helpers --

export function getBuckets(viewName: string, tasks: Task[]): Buckets {
  if (viewName === "projects" || viewName === "today") return {};
  const hash = hashTasks(tasks);
  const cached = readCache(viewName);
  if (cached && cached.hash === hash) return cached.buckets;
  return fallbackCategorize(viewName, tasks);
}

export function filterBucketIndices(
  indices: number[],
  tasks: Task[],
  visibleIdx: Map<string, number>,
): number[] {
  return indices
    .filter(i => tasks[i] && visibleIdx.has(tasks[i]!.id))
    .sort((a, b) => (visibleIdx.get(tasks[a]!.id) ?? 0) - (visibleIdx.get(tasks[b]!.id) ?? 0));
}
