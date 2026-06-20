import {
  TUI, Container, type Component,
  ProcessTerminal,
  Input,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import chalk from "chalk";
import { parseAllFiles, parseOneFile, type Task } from "./parser";
import { categorizeTasks, studioChat, type Buckets } from "./categorizer";
import { startWatcher } from "./watcher";
import type { DadTodoConfig } from "./config";
import { getCacheDir, saveConfig } from "./config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import type { FSWatcher } from "node:fs";
import { spawn } from "node:child_process";

// View definitions
const VIEWS = [
  { key: "projects", label: "Projects", num: "1" },
  { key: "gtd", label: "GTD", num: "2" },
  { key: "eisenhower", label: "Eisenhower", num: "3" },
  { key: "kanban", label: "Kanban", num: "4" },
  { key: "postit", label: "Post-Its", num: "5" },
  { key: "calendar", label: "Calendar", num: "6" },
  { key: "mindmap", label: "Mind Map", num: "7" },
] as const;

type ViewName = (typeof VIEWS)[number]["key"];
type ActiveViewName = ViewName | `custom:${string}`;
type SortBy = "default" | "due" | "status" | "project";
type UndoEntry = {
  filePath: string;
  before: string;
  after: string;
  description: string;
};
type StatusKind = "info" | "success" | "warning" | "error";
type CustomView = {
  name: string;
  categorizationPrompt: string;
  buckets?: Buckets;
};

// -- Color themes --
type ThemeName = "default" | "warm" | "cool" | "mono";
interface ThemeColors {
  accent: (s: string) => string;
  heading: (s: string) => string;
  selected: (s: string) => string;
  done: (s: string) => string;
  overdue: (s: string) => string;
  muted: (s: string) => string;
  tab: (s: string) => string;
  tabActive: (s: string) => string;
}

const THEMES: Record<ThemeName, ThemeColors> = {
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
function fallbackCategorize(viewName: string, tasks: Task[]): Buckets {
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
function hashTasks(tasks: Task[]): string {
  const key = tasks
    .map(t => `${t.id}\0${t.status}\0${t.content}\0${t.dueDate ?? ""}\0${t.doneDate ?? ""}\0${t.tags.join(",")}`)
    .join("\n");
  return createHash("sha256").update(key).digest("hex");
}

function readCache(viewName: string): { hash: string; buckets: Buckets } | null {
  try {
    return JSON.parse(readFileSync(join(getCacheDir(), `${viewName}.json`), "utf-8"));
  } catch { return null; }
}

function writeCache(viewName: string, hash: string, buckets: Buckets) {
  try {
    writeFileSync(join(getCacheDir(), `${viewName}.json`), JSON.stringify({ hash, buckets, timestamp: Date.now() }));
  } catch {}
}

// -- Simple component: renders lines from a function --
class DynamicComponent implements Component {
  private renderFn: (width: number) => string[];
  constructor(renderFn: (width: number) => string[]) { this.renderFn = renderFn; }
  render(width: number): string[] { return this.renderFn(width); }
  invalidate() {}
}

// -- Main App --
export class DadTodoApp {
  private tui!: TUI;
  private terminal!: ProcessTerminal;
  private config: DadTodoConfig;
  private tasks: Task[] = [];
  private activeView: ActiveViewName = "projects";
  private buckets: Buckets = {};
  private selectedIndex = 0;
  private scrollOffset = 0;
  private chatMessages: { role: "user" | "ai"; text: string }[] = [];
  private chatFocused = false;
  private hideDone = false;
  private searchFilter = "";
  private searchActive = false;
  private sortBy: SortBy = "default";
  private projectFilter = "";
  private colorTheme: "default" | "warm" | "cool" | "mono" = "default";
  private customViews: CustomView[] = [];
  private statusMessage = "";
  private statusKind: StatusKind = "info";
  private watcher: FSWatcher | null = null;
  private undoStack: UndoEntry[] = [];
  private helpOpen = false;
  private quitPending = false;
  private chatScrollOffset = 0;
  private addActive = false;
  private editActive = false;
  private aiErrorShown = false;
  private gPending = false;
  private gTimer: ReturnType<typeof setTimeout> | null = null;
  private selectedIds = new Set<string>();
  private selectedLineIndex = 0;
  private calendarMonthOffset = 0;
  private deletePendingIds = new Set<string>();
  private input!: Input;
  private searchInput!: Input;
  private addInput!: Input;
  private editInput!: Input;

  private get theme(): ThemeColors { return THEMES[this.colorTheme]; }

  private setStatus(message: string, kind: StatusKind = "info") {
    this.statusMessage = message;
    this.statusKind = kind;
  }

  private statusColor(text: string): string {
    if (this.statusKind === "error") return chalk.red(text);
    if (this.statusKind === "warning") return chalk.yellow(text);
    if (this.statusKind === "success") return chalk.green(text);
    return chalk.dim(text);
  }

  private getSelectedTask(): Task | undefined {
    return this.getVisibleTasks()[this.selectedIndex];
  }

  private getQuickAddTargetFile(): string {
    return this.getSelectedTask()?.filePath
      ?? this.tasks[0]?.filePath
      ?? join(this.config.watched_dir, "inbox.md");
  }

  private renderBareInput(input: Input, width: number): string {
    const value = input.getValue();
    if (value.length <= width) return value;
    return value.slice(Math.max(0, value.length - width));
  }

  private saveSessionState() {
    this.config.custom_views = this.customViews.map(v => ({
      name: v.name,
      categorizationPrompt: v.categorizationPrompt,
    }));
    this.config.chat_history = this.chatMessages.slice(-100);
    saveConfig(this.config);
  }

  // Components
  private topBar!: DynamicComponent;
  private searchBar!: Container;
  private searchLabel!: DynamicComponent;
  private taskPane!: DynamicComponent;
  private chatPane!: Container;
  private chatHistory!: DynamicComponent;

  constructor(config: DadTodoConfig) {
    this.config = config;
    this.hideDone = config.preferences?.hideDone ?? false;
    this.sortBy = config.preferences?.sortBy ?? "default";
    this.colorTheme = config.preferences?.colorTheme ?? "default";
    this.customViews = (config.custom_views ?? []).map(v => ({
      name: v.name,
      categorizationPrompt: v.categorizationPrompt,
    }));
    this.chatMessages = config.chat_history ?? [];
  }

  async start() {
    // Parse tasks
    this.tasks = await this.parseConfiguredFiles();

    // Start file watcher
    try {
      this.watcher = startWatcher(this.config.watched_dir, this.config.file_types, async (filePath) => {
        await this.refreshFile(filePath);
      });
    } catch (err: any) {
      this.setStatus(`Watcher disabled: ${err.message || String(err)}`, "error");
    }

    // Init buckets
    this.buckets = this.getBuckets(this.activeView);

    // Build TUI
    this.terminal = new ProcessTerminal();
    this.tui = new TUI(this.terminal, true);

    // Top bar
    this.topBar = new DynamicComponent((w) => this.renderTopBar(w));

    // Task pane
    this.taskPane = new DynamicComponent((w) => this.renderTaskPane(w));

    // Chat input
    this.input = new Input();
    this.input.onSubmit = (value: string) => {
      if (!value.trim()) return;
      this.chatMessages.push({ role: "user", text: value });
      this.chatScrollOffset = 0;
      this.saveSessionState();
      this.input.setValue("");
      this.handleChatMessage(value);
      this.tui.invalidate();
      this.tui.requestRender();
    };
    this.input.onEscape = () => {
      this.chatFocused = false;
      this.tui.setFocus(null);
      this.tui.invalidate();
      this.tui.requestRender();
    };

    // Search input
    this.searchInput = new Input();
    this.searchInput.onSubmit = () => {
      this.searchFilter = this.searchInput.getValue();
      this.searchActive = false;
      this.tui.setFocus(null);
      this.tui.invalidate();
      this.tui.requestRender();
    };
    this.searchInput.onEscape = () => {
      this.searchActive = false;
      this.searchFilter = "";
      this.searchInput.setValue("");
      this.tui.setFocus(null);
      this.tui.invalidate();
      this.tui.requestRender();
    };

    // Quick-add input
    this.addInput = new Input();
    this.addInput.onSubmit = (value: string) => {
      const text = value.trim();
      this.addActive = false;
      this.tui.setFocus(null);
      if (text) this.quickAddTask(text);
      this.addInput.setValue("");
      this.tui.invalidate();
      this.tui.requestRender();
    };
    this.addInput.onEscape = () => {
      this.addActive = false;
      this.addInput.setValue("");
      this.tui.setFocus(null);
      this.tui.invalidate();
      this.tui.requestRender();
    };

    // Inline edit input
    this.editInput = new Input();
    this.editInput.onSubmit = (value: string) => {
      const text = value.trim();
      this.editActive = false;
      this.tui.setFocus(null);
      if (text) this.editSelectedTask(text);
      this.editInput.setValue("");
      this.tui.invalidate();
      this.tui.requestRender();
    };
    this.editInput.onEscape = () => {
      this.editActive = false;
      this.editInput.setValue("");
      this.tui.setFocus(null);
      this.tui.invalidate();
      this.tui.requestRender();
    };

    // Chat history
    this.chatHistory = new DynamicComponent((w) => this.renderChatHistory(w));

    // Chat pane container
    this.chatPane = new Container();
    this.chatPane.addChild(this.chatHistory);
    this.chatPane.addChild(this.input);

    // Main layout
    this.tui.addChild(this.topBar);
    this.tui.addChild(this.taskPane);
    this.tui.addChild(this.chatPane);

    // Global key handler
    this.tui.addInputListener((data: string) => {
      if (this.chatFocused) {
        if (matchesKey(data, "pageUp")) {
          this.chatScrollOffset += 4;
          this.tui.invalidate();
          this.tui.requestRender();
          return { consume: true };
        }
        if (matchesKey(data, "pageDown")) {
          this.chatScrollOffset = Math.max(0, this.chatScrollOffset - 4);
          this.tui.invalidate();
          this.tui.requestRender();
          return { consume: true };
        }
        return undefined;
      }
      if (this.searchActive || this.addActive || this.editActive) return undefined;
      return this.handleGlobalKeys(data);
    });

    this.tui.start();
    this.terminal.setTitle("DadTodo");
    this.tui.requestRender(true);

    // Prefetch AI categorizations in background
    if (!this.config.ai_configured) {
      this.setStatus("AI not configured; using rule-based views", "warning");
    }
    this.prefetchAll();
  }

  private parseConfiguredFiles(): Promise<Task[]> {
    if (!existsSync(this.config.watched_dir)) {
      this.setStatus(`Folder missing: ${this.config.watched_dir}`, "error");
      return Promise.resolve([]);
    }
    if (this.statusMessage.startsWith("Folder missing:")) this.setStatus("", "info");
    return parseAllFiles(this.config.watched_dir, {
      fileTypes: this.config.file_types,
      parseMode: this.config.parse_mode,
    });
  }

  private async refreshFile(filePath: string, quiet = false) {
    if (!existsSync(this.config.watched_dir)) {
      this.setStatus(`Folder missing: ${this.config.watched_dir}`, "error");
      this.tasks = [];
    } else {
      const parsed = await parseOneFile(filePath, this.config.watched_dir, {
        fileTypes: this.config.file_types,
        parseMode: this.config.parse_mode,
      });
      this.tasks = [
        ...this.tasks.filter(t => t.filePath !== filePath),
        ...parsed,
      ].sort((a, b) => a.filePath.localeCompare(b.filePath) || a.lineNumber - b.lineNumber);
      if (!quiet) {
        this.setStatus(
          parsed.length > 0 ? `Updated ${basename(filePath)}` : `Removed tasks from ${basename(filePath)}`,
          parsed.length > 0 ? "success" : "warning",
        );
      }
    }
    this.clampSelection();
    this.buckets = this.getBuckets(this.activeView);
    this.tui.invalidate();
    this.tui.requestRender();
  }

  private getBuckets(viewName: string): Buckets {
    if (viewName === "projects") return {};
    const hash = hashTasks(this.tasks);
    const cached = readCache(viewName);
    if (cached && cached.hash === hash) return cached.buckets;
    return fallbackCategorize(viewName, this.tasks);
  }

  private async prefetchAll() {
    const hash = hashTasks(this.tasks);
    const aiViews = ["gtd", "eisenhower", "kanban", "postit", "calendar", "mindmap"];
    for (const view of aiViews) {
      const cached = readCache(view);
      if (cached && cached.hash === hash) continue;
      try {
        const aiTasks = this.tasks.length > 200 ? this.tasks.slice(0, 200) : this.tasks;
        const buckets = await categorizeTasks(view, aiTasks, undefined, this.config.ai_timeout_ms);
        writeCache(view, hash, buckets);
        if (view === this.activeView) {
          this.buckets = buckets;
          this.tui.invalidate();
          this.tui.requestRender();
        }
      } catch (err: any) {
        if (!this.aiErrorShown) {
          this.aiErrorShown = true;
          this.setStatus(`AI unavailable; using fallback (${err.message || String(err)})`, "warning");
          this.tui.invalidate();
          this.tui.requestRender();
        }
      }
    }
  }

  private handleGlobalKeys(data: string): { consume: boolean } | undefined {
    if (data !== "q") this.quitPending = false;
    if (data !== "g" && this.gPending) this.clearGPending();
    if (data !== "d" && data !== "x") this.deletePendingIds.clear();

    if (data === "?") {
      this.helpOpen = !this.helpOpen;
      this.tui.invalidate();
      this.tui.requestRender();
      return { consume: true };
    }

    if (data === "u") {
      this.undoLast();
      return { consume: true };
    }

    if (data === "m") {
      this.toggleMultiSelect();
      return { consume: true };
    }

    if (data === "i") {
      this.startInlineEdit();
      return { consume: true };
    }

    if (data === "e") {
      this.openSelectedInEditor();
      return { consume: true };
    }

    if (data === "d" || data === "x") {
      this.deleteSelectedTasks();
      return { consume: true };
    }

    if (this.activeView === "calendar" && (data === "[" || data === "]")) {
      this.calendarMonthOffset += data === "]" ? 1 : -1;
      this.scrollOffset = 0;
      this.setStatus(`Calendar: ${this.calendarMonthLabel()}`, "info");
      this.tui.invalidate();
      this.tui.requestRender();
      return { consume: true };
    }

    if (data === "a" || data === "n") {
      this.addActive = true;
      this.addInput.setValue("");
      this.tui.setFocus(this.addInput);
      this.tui.invalidate();
      this.tui.requestRender();
      return { consume: true };
    }

    // Number keys to switch views
    for (const v of VIEWS) {
      if (data === v.num) {
        this.switchView(v.key);
        return { consume: true };
      }
    }
    const customKeyIndex = ["8", "9", "0"].indexOf(data);
    if (customKeyIndex !== -1 && this.customViews[customKeyIndex]) {
      this.switchView(`custom:${this.customViews[customKeyIndex]!.name}`);
      return { consume: true };
    }

    if (data === "j" || matchesKey(data, "down")) {
      const count = this.getVisibleTasks().length;
      this.selectedIndex = count === 0 ? 0 : Math.min(this.selectedIndex + 1, count - 1);
      this.tui.invalidate();
      this.tui.requestRender();
      return { consume: true };
    }
    if (matchesKey(data, "pageDown")) {
      const count = this.getVisibleTasks().length;
      const step = Math.max(5, this.getTaskPaneHeight() - 2);
      this.selectedIndex = count === 0 ? 0 : Math.min(this.selectedIndex + step, count - 1);
      this.tui.invalidate();
      this.tui.requestRender();
      return { consume: true };
    }
    if (matchesKey(data, "pageUp")) {
      const step = Math.max(5, this.getTaskPaneHeight() - 2);
      this.selectedIndex = Math.max(this.selectedIndex - step, 0);
      this.tui.invalidate();
      this.tui.requestRender();
      return { consume: true };
    }
    if (data === "G") {
      const count = this.getVisibleTasks().length;
      this.selectedIndex = count === 0 ? 0 : count - 1;
      this.tui.invalidate();
      this.tui.requestRender();
      return { consume: true };
    }
    if (data === "g") {
      if (this.gPending) {
        this.scrollOffset = 0;
        this.selectedIndex = 0;
        this.clearGPending();
      } else {
        this.gPending = true;
        this.setStatus("Press g again within 1s for top", "info");
        this.gTimer = setTimeout(() => {
          this.clearGPending();
          this.tui.invalidate();
          this.tui.requestRender();
        }, 1000);
      }
      this.tui.invalidate();
      this.tui.requestRender();
      return { consume: true };
    }
    if (data === "k" || matchesKey(data, "up")) {
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      this.tui.invalidate();
      this.tui.requestRender();
      return { consume: true };
    }
    if (data === " " || data === "\r") {
      this.toggleSelected();
      return { consume: true };
    }
    if (data === "c") {
      this.convertSelected();
      return { consume: true };
    }
    if (data === "\t") {
      this.chatFocused = true;
      this.tui.setFocus(this.input);
      this.tui.invalidate();
      this.tui.requestRender();
      return { consume: true };
    }
    if (data === "/") {
      this.searchActive = true;
      this.tui.setFocus(this.searchInput);
      this.tui.invalidate();
      this.tui.requestRender();
      return { consume: true };
    }
    if (data === "r") {
      this.reload();
      return { consume: true };
    }
    if (data === "q") {
      if (this.quitPending) this.stop();
      else {
        this.quitPending = true;
        this.setStatus("Press q again to quit", "warning");
        this.tui.invalidate();
        this.tui.requestRender();
      }
      return { consume: true };
    }
    return undefined;
  }

  private switchView(view: ActiveViewName) {
    this.activeView = view;
    this.selectedIndex = 0;
    this.scrollOffset = 0;
    if (view.startsWith("custom:")) {
      const name = view.slice("custom:".length);
      const custom = this.customViews.find(v => v.name === name);
      this.buckets = custom?.buckets ?? fallbackCategorize("postit", this.tasks);
      if (custom && !custom.buckets) void this.refreshCustomView(custom);
    } else {
      this.buckets = this.getBuckets(view);
    }
    this.tui.invalidate();
    this.tui.requestRender();
  }

  private async refreshCustomView(custom: CustomView) {
    try {
      const aiTasks = this.tasks.length > 200 ? this.tasks.slice(0, 200) : this.tasks;
      custom.buckets = await categorizeTasks("custom", aiTasks, custom.categorizationPrompt, this.config.ai_timeout_ms);
      if (this.activeView === `custom:${custom.name}`) {
        this.buckets = custom.buckets;
        this.tui.invalidate();
        this.tui.requestRender();
      }
    } catch (err: any) {
      this.setStatus(`Custom view fallback: ${err.message || String(err)}`, "warning");
    }
  }

  private clearGPending() {
    this.gPending = false;
    if (this.gTimer) clearTimeout(this.gTimer);
    this.gTimer = null;
  }

  private persistPreferences() {
    this.config.preferences = {
      hideDone: this.hideDone,
      sortBy: this.sortBy,
      colorTheme: this.colorTheme,
    };
    saveConfig(this.config);
  }

  private getVisibleTasks(): Task[] {
    let list: Task[];
    if (this.activeView === "projects") {
      list = [...this.tasks];
    } else {
      const all = (Object.values(this.buckets) as number[][]).flat();
      list = all.map(i => this.tasks[i]).filter(Boolean) as Task[];
    }
    if (this.hideDone) list = list.filter(t => t.status !== "done");
    if (this.projectFilter) {
      const q = this.projectFilter.toLowerCase();
      list = list.filter(t => t.project.toLowerCase().includes(q));
    }
    if (this.searchFilter) {
      const q = this.searchFilter.toLowerCase();
      list = list.filter(t => this.taskSearchText(t).includes(q));
    }
    if (this.sortBy !== "default") {
      list.sort((a, b) => {
        if (this.sortBy === "due") return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
        if (this.sortBy === "status") return a.status.localeCompare(b.status);
        if (this.sortBy === "project") return a.project.localeCompare(b.project);
        return 0;
      });
    }
    return list;
  }

  private taskSearchText(task: Task): string {
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

  private getVisibleIndexMap(): Map<string, number> {
    return new Map(this.getVisibleTasks().map((task, index) => [task.id, index]));
  }

  private filterBucketIndices(indices: number[], visibleIdx = this.getVisibleIndexMap()): number[] {
    return indices
      .filter(i => this.tasks[i] && visibleIdx.has(this.tasks[i]!.id))
      .sort((a, b) => (visibleIdx.get(this.tasks[a]!.id) ?? 0) - (visibleIdx.get(this.tasks[b]!.id) ?? 0));
  }

  private clampSelection() {
    const count = this.getVisibleTasks().length;
    this.selectedIndex = count === 0 ? 0 : Math.min(this.selectedIndex, count - 1);
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, this.selectedIndex));
  }

  private toggleSelected() {
    const marked = this.getVisibleTasks().filter(t => this.selectedIds.has(t.id));
    if (marked.length > 0) {
      let changed = 0;
      for (const task of marked) {
        if (task.sourceType !== "checkbox") continue;
        const newStatus = task.status === "done" ? "open" : "done";
        const marker = newStatus === "done" ? "x" : " ";
        const today = new Date().toISOString().slice(0, 10);
        let newRaw = task.raw.replace(/\[[ x/]\]/, `[${marker}]`);
        if (newStatus === "done" && !newRaw.includes("<!-- done:")) newRaw = newRaw.trimEnd() + ` <!-- done:${today} -->`;
        if (newStatus === "open") newRaw = newRaw.replace(/\s*<!--\s*done:\d{4}-\d{2}-\d{2}\s*-->/, "");
        if (this.updateLine(task.filePath, task.lineNumber, newRaw, `toggle "${task.content}"`)) changed++;
      }
      this.setStatus(`Toggled ${changed} marked task(s) (u to undo)`, "success");
      return;
    }
    const visible = this.getVisibleTasks();
    const task = visible[this.selectedIndex];
    if (!task) return;
    if (task.sourceType !== "checkbox") {
      this.setStatus("Selected item is not a checkbox. Press c to convert it.", "warning");
      this.tui.invalidate();
      this.tui.requestRender();
      return;
    }

    const newStatus = task.status === "done" ? "open" : "done";
    const marker = newStatus === "done" ? "x" : " ";
    const today = new Date().toISOString().slice(0, 10);
    let newRaw = task.raw.replace(/\[[ x/]\]/, `[${marker}]`);
    if (newStatus === "done" && !newRaw.includes("<!-- done:")) {
      newRaw = newRaw.trimEnd() + ` <!-- done:${today} -->`;
    }
    if (newStatus === "open") {
      newRaw = newRaw.replace(/\s*<!--\s*done:\d{4}-\d{2}-\d{2}\s*-->/, "");
    }
    this.updateLine(task.filePath, task.lineNumber, newRaw, `toggle "${task.content}"`);
    this.setStatus(`Marked "${task.content}" ${newStatus === "done" ? "done" : "open"} (u to undo)`, "success");
  }

  private selectedOrMarkedTasks(): Task[] {
    const visible = this.getVisibleTasks();
    const marked = visible.filter(t => this.selectedIds.has(t.id));
    return marked.length > 0 ? marked : visible[this.selectedIndex] ? [visible[this.selectedIndex]!] : [];
  }

  private toggleMultiSelect() {
    const task = this.getSelectedTask();
    if (!task) return;
    if (this.selectedIds.has(task.id)) {
      this.selectedIds.delete(task.id);
      this.setStatus(`Unmarked "${task.content}"`, "info");
    } else {
      this.selectedIds.add(task.id);
      this.setStatus(`Marked ${this.selectedIds.size} task(s)`, "success");
    }
    this.tui.invalidate();
    this.tui.requestRender();
  }

  private startInlineEdit() {
    const task = this.getSelectedTask();
    if (!task) {
      this.setStatus("No task selected", "warning");
      return;
    }
    this.editActive = true;
    this.editInput.setValue(task.content);
    this.tui.setFocus(this.editInput);
    this.tui.invalidate();
    this.tui.requestRender();
  }

  private editSelectedTask(newText: string) {
    const task = this.getSelectedTask();
    if (!task) return;
    const idx = task.raw.indexOf(task.content);
    const newRaw = idx >= 0
      ? task.raw.slice(0, idx) + newText + task.raw.slice(idx + task.content.length)
      : task.raw.replace(/(.+)/, newText);
    if (this.updateLine(task.filePath, task.lineNumber, newRaw, `edit "${task.content}"`)) {
      this.setStatus(`Edited "${task.content}" (u to undo)`, "success");
    }
  }

  private deleteSelectedTasks() {
    const tasks = this.selectedOrMarkedTasks();
    if (tasks.length === 0) {
      this.setStatus("No task selected", "warning");
      return;
    }
    const ids = new Set(tasks.map(t => t.id));
    const samePending = tasks.length === this.deletePendingIds.size
      && tasks.every(t => this.deletePendingIds.has(t.id));
    if (!samePending) {
      this.deletePendingIds = ids;
      this.setStatus(`Press d again to delete ${tasks.length} task(s). u can undo after delete.`, "warning");
      this.tui.invalidate();
      this.tui.requestRender();
      return;
    }
    const byFile = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!byFile.has(task.filePath)) byFile.set(task.filePath, []);
      byFile.get(task.filePath)!.push(task);
    }
    for (const [filePath, fileTasks] of byFile) {
      const before = readFileSync(filePath, "utf-8");
      const lines = before.split("\n");
      const lineNums = new Set(fileTasks.map(t => t.lineNumber));
      const after = lines.filter((_, i) => !lineNums.has(i + 1)).join("\n");
      this.writeFileWithUndo(filePath, before, after, `delete ${fileTasks.length} task(s)`);
    }
    this.selectedIds.clear();
    this.deletePendingIds.clear();
    this.setStatus(`Deleted ${tasks.length} task(s) (u to undo)`, "success");
  }

  private openSelectedInEditor() {
    const task = this.getSelectedTask();
    if (!task) {
      this.setStatus("No task selected", "warning");
      return;
    }
    const editor = process.env.EDITOR || process.env.VISUAL;
    if (!editor) {
      this.setStatus("Set $EDITOR to use open-in-editor", "warning");
      return;
    }
    const args = editor.includes("vim") || editor.includes("nvim") || editor.includes("nano")
      ? [`+${task.lineNumber}`, task.filePath]
      : [task.filePath];
    this.tui.stop();
    const child = spawn(editor, args, { stdio: "inherit" });
    child.on("exit", () => {
      this.tui.start();
      this.tui.setFocus(null);
      void this.refreshFile(task.filePath);
    });
    this.setStatus(`Opened ${basename(task.filePath)}:${task.lineNumber}`, "success");
  }

  private convertSelected() {
    const visible = this.getVisibleTasks();
    const task = visible[this.selectedIndex];
    if (!task || task.sourceType === "checkbox") return;

    let newRaw: string;
    if (/^\s*[-*+]\s+/.test(task.raw)) {
      newRaw = task.raw.replace(/^(\s*[-*+])\s+/, "$1 [ ] ");
    } else if (/^\s*\d+[.)]\s+/.test(task.raw)) {
      newRaw = task.raw.replace(/^(\s*)\d+[.)]\s+/, "$1- [ ] ");
    } else {
      newRaw = task.raw.replace(/^(\s*)/, "$1- [ ] ");
    }
    this.updateLine(task.filePath, task.lineNumber, newRaw, `convert "${task.content}"`);
    this.setStatus(`Converted "${task.content}" to checkbox (u to undo)`, "success");
  }

  private updateLine(filePath: string, lineNumber: number, newContent: string, description = "edit task"): boolean {
    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      if (lineNumber >= 1 && lineNumber <= lines.length) {
        lines[lineNumber - 1] = newContent;
        return this.writeFileWithUndo(filePath, content, lines.join("\n"), description);
      }
    } catch (err: any) {
      this.setStatus(`Write failed: ${err.message || String(err)}`, "error");
    }
    return false;
  }

  private writeFileWithUndo(filePath: string, before: string, after: string, description: string): boolean {
    if (before === after) return false;
    try {
      writeFileSync(filePath, after, "utf-8");
      this.undoStack.push({ filePath, before, after, description });
      if (this.undoStack.length > 20) this.undoStack.shift();
      void this.refreshFile(filePath, true);
      return true;
    } catch (err: any) {
      this.setStatus(`Write failed: ${err.message || String(err)}`, "error");
      return false;
    }
  }

  private undoLast() {
    const entry = this.undoStack.pop();
    if (!entry) {
      this.setStatus("Nothing to undo", "info");
      this.tui.invalidate();
      this.tui.requestRender();
      return;
    }
    try {
      const current = existsSync(entry.filePath) ? readFileSync(entry.filePath, "utf-8") : "";
      if (current !== entry.after) {
        this.setStatus(`Undo skipped: ${basename(entry.filePath)} changed again`, "warning");
      } else {
        writeFileSync(entry.filePath, entry.before, "utf-8");
        this.setStatus(`Undid ${entry.description}`, "success");
        void this.refreshFile(entry.filePath, true);
      }
    } catch (err: any) {
      this.setStatus(`Undo failed: ${err.message || String(err)}`, "error");
    }
    this.tui.invalidate();
    this.tui.requestRender();
  }

  private quickAddTask(text: string) {
    const targetFile = this.getQuickAddTargetFile();
    const before = existsSync(targetFile) ? readFileSync(targetFile, "utf-8") : "";
    const separator = before === "" || before.endsWith("\n") ? "" : "\n";
    const after = `${before}${separator}- [ ] ${text}\n`;
    if (this.writeFileWithUndo(targetFile, before, after, `add "${text}"`)) {
      this.setStatus(`Added "${text}" to ${basename(targetFile)} (u to undo)`, "success");
    }
  }

  private calendarMonthLabel(): string {
    const d = new Date();
    d.setMonth(d.getMonth() + this.calendarMonthOffset);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }

  private async reload() {
    this.tasks = await this.parseConfiguredFiles();
    this.clampSelection();
    this.buckets = this.getBuckets(this.activeView);
    this.tui.invalidate();
    this.tui.requestRender();
  }

  private reply(text: string) {
    this.chatMessages.push({ role: "ai", text });
    this.chatScrollOffset = 0;
    this.saveSessionState();
    this.tui.invalidate();
    this.tui.requestRender();
  }

  private async handleChatMessage(message: string) {
    const lower = message.toLowerCase().trim();

    // -- View switch --
    for (const v of VIEWS) {
      if (lower === v.key || lower === v.label.toLowerCase() || lower.startsWith(`switch to ${v.key}`) || lower.startsWith(`switch to ${v.label.toLowerCase()}`)) {
        this.switchView(v.key);
        return this.reply(`Switched to ${v.label} view.`);
      }
    }
    const customView = this.customViews.find(v =>
      lower === v.name.toLowerCase() || lower.startsWith(`switch to ${v.name.toLowerCase()}`)
    );
    if (customView) {
      this.switchView(`custom:${customView.name}`);
      return this.reply(`Switched to ${customView.name} view.`);
    }

    // -- Hide/show done --
    if (/^(hide done|hide done tasks|hide completed)$/.test(lower)) {
      this.hideDone = true;
      this.clampSelection();
      this.persistPreferences();
      return this.reply("Hiding done tasks.");
    }
    if (/^(show done|show done tasks|show all|show completed)$/.test(lower)) {
      this.hideDone = false;
      this.clampSelection();
      this.persistPreferences();
      return this.reply("Showing all tasks.");
    }

    // -- Sort commands --
    if (/^sort by (due|due date|deadline)/.test(lower)) {
      this.sortBy = "due";
      this.clampSelection();
      this.persistPreferences();
      return this.reply("Sorting by due date.");
    }
    if (/^sort by (status|state)/.test(lower)) {
      this.sortBy = "status";
      this.clampSelection();
      this.persistPreferences();
      return this.reply("Sorting by status.");
    }
    if (/^sort by (project|file)/.test(lower)) {
      this.sortBy = "project";
      this.clampSelection();
      this.persistPreferences();
      return this.reply("Sorting by project.");
    }
    if (/^(sort by default|reset sort|unsort|clear sort)/.test(lower)) {
      this.sortBy = "default";
      this.clampSelection();
      this.persistPreferences();
      return this.reply("Reset to default sort.");
    }
    if (/^group by file/.test(lower)) {
      this.switchView("projects");
      return this.reply("Switched to Projects view (grouped by file).");
    }

    // -- Project filter --
    const showOnlyMatch = lower.match(/^show only (\w+)( tasks)?$/);
    if (showOnlyMatch) {
      this.projectFilter = showOnlyMatch[1]!;
      return this.reply(`Showing only "${this.projectFilter}" tasks.`);
    }
    if (/^(clear filter|show all projects|reset filter)/.test(lower)) {
      this.projectFilter = "";
      this.searchFilter = "";
      this.searchInput.setValue("");
      return this.reply("Filters cleared.");
    }

    const editMatch = lower.match(/^edit (?:task )?(\d+) to ['"]?(.+?)['"]?$/);
    if (editMatch) {
      const idx = parseInt(editMatch[1]!) - 1;
      const task = this.getVisibleTasks()[idx];
      if (!task) return this.reply(`No task #${idx + 1}.`);
      const oldSelected = this.selectedIndex;
      this.selectedIndex = idx;
      this.editSelectedTask(editMatch[2]!);
      this.selectedIndex = oldSelected;
      return this.reply(`Edited task #${idx + 1}.`);
    }

    const deleteMatch = lower.match(/^delete (?:task )?(\d+)$/);
    if (deleteMatch) {
      const idx = parseInt(deleteMatch[1]!) - 1;
      const task = this.getVisibleTasks()[idx];
      if (!task) return this.reply(`No task #${idx + 1}.`);
      const before = readFileSync(task.filePath, "utf-8");
      const lines = before.split("\n");
      const after = lines.filter((_, i) => i + 1 !== task.lineNumber).join("\n");
      this.writeFileWithUndo(task.filePath, before, after, `delete "${task.content}"`);
      return this.reply(`Deleted "${task.content}" (u to undo).`);
    }

    const tagMatch = lower.match(/^(tag|untag|remove tag from) (?:task )?(\d+) (?:with |as |from )?@?([\w-]+)/);
    if (tagMatch) {
      const op = tagMatch[1]!;
      const idx = parseInt(tagMatch[2]!) - 1;
      const tag = tagMatch[3]!;
      const task = this.getVisibleTasks()[idx];
      if (!task) return this.reply(`No task #${idx + 1}.`);
      const tags = new Set(task.tags);
      if (op === "tag") tags.add(tag);
      else tags.delete(tag);
      const tagComment = tags.size > 0 ? ` <!-- tags:${Array.from(tags).join(",")} -->` : "";
      let newRaw = task.raw;
      if (/<!--\s*tags:[\w,-]+\s*-->/.test(newRaw)) {
        newRaw = tagComment
          ? newRaw.replace(/<!--\s*tags:[\w,-]+\s*-->/, tagComment.trim())
          : newRaw.replace(/\s*<!--\s*tags:[\w,-]+\s*-->/, "");
      } else if (tagComment) {
        newRaw = newRaw.trimEnd() + tagComment;
      }
      this.updateLine(task.filePath, task.lineNumber, newRaw, `${op} "${task.content}"`);
      return this.reply(`${op === "tag" ? "Tagged" : "Untagged"} task #${idx + 1} ${tag}.`);
    }

    // -- Mark task done by number --
    const markMatch = lower.match(/^mark (?:task )?(\d+) (?:as )?(done|open|complete|incomplete)/);
    if (markMatch) {
      const idx = parseInt(markMatch[1]!) - 1;
      const visible = this.getVisibleTasks();
      if (idx < 0 || idx >= visible.length) return this.reply(`No task #${idx + 1}. You have ${visible.length} visible tasks.`);
      const task = visible[idx]!;
      const wantDone = markMatch[2] === "done" || markMatch[2] === "complete";
      if (task.sourceType !== "checkbox") {
        return this.reply(`Task #${idx + 1} is a ${task.sourceType}, not a checkbox. Use "c" to convert it first.`);
      }
      const marker = wantDone ? "x" : " ";
      const today = new Date().toISOString().slice(0, 10);
      let newRaw = task.raw.replace(/\[[ x/]\]/, `[${marker}]`);
      if (wantDone && !newRaw.includes("<!-- done:")) newRaw = newRaw.trimEnd() + ` <!-- done:${today} -->`;
      if (!wantDone) newRaw = newRaw.replace(/\s*<!--\s*done:\d{4}-\d{2}-\d{2}\s*-->/, "");
      this.updateLine(task.filePath, task.lineNumber, newRaw);
      return this.reply(`Marked "${task.content}" as ${wantDone ? "done" : "open"}.`);
    }

    // -- Set due date --
    const dueMatch = lower.match(/^set due (?:date )?(?:for )?['"]?(.+?)['"]? to (\S+)/);
    if (dueMatch) {
      const query = dueMatch[1]!.toLowerCase();
      const dateStr = this.resolveDate(dueMatch[2]!);
      const task = this.tasks.find(t => t.content.toLowerCase().includes(query));
      if (!task) return this.reply(`No task matching "${query}".`);
      let newRaw = task.raw;
      if (task.dueDate) {
        newRaw = newRaw.replace(/<!--\s*due:\d{4}-\d{2}-\d{2}\s*-->/, `<!-- due:${dateStr} -->`);
        newRaw = newRaw.replace(/@due\(\d{4}-\d{2}-\d{2}\)/, `@due(${dateStr})`);
      } else {
        newRaw = newRaw.trimEnd() + ` <!-- due:${dateStr} -->`;
      }
      this.updateLine(task.filePath, task.lineNumber, newRaw);
      return this.reply(`Set due date for "${task.content}" to ${dateStr}.`);
    }

    // -- Move tasks to next week --
    if (/^move .+ to next week/.test(lower)) {
      if (/^move marked to next week/.test(lower)) {
        const marked = this.getVisibleTasks().filter(t => this.selectedIds.has(t.id));
        if (marked.length === 0) return this.reply("No marked tasks. Press m on tasks first.");
        const nextMon = new Date();
        nextMon.setDate(nextMon.getDate() + (8 - nextMon.getDay()) % 7 || 7);
        const dateStr = nextMon.toISOString().slice(0, 10);
        for (const task of marked) {
          let newRaw = task.raw;
          if (task.dueDate) newRaw = newRaw.replace(/<!--\s*due:\d{4}-\d{2}-\d{2}\s*-->/, `<!-- due:${dateStr} -->`);
          else newRaw = newRaw.trimEnd() + ` <!-- due:${dateStr} -->`;
          this.updateLine(task.filePath, task.lineNumber, newRaw, `move "${task.content}"`);
        }
        return this.reply(`Moved ${marked.length} marked task(s) to next week (${dateStr}).`);
      }
      const queryPart = lower.replace(/^move /, "").replace(/ to next week$/, "").replace(/all /, "").trim();
      const nextMon = new Date();
      nextMon.setDate(nextMon.getDate() + (8 - nextMon.getDay()) % 7 || 7);
      const dateStr = nextMon.toISOString().slice(0, 10);
      const matching = this.tasks.filter(t => t.content.toLowerCase().includes(queryPart) || t.project.toLowerCase().includes(queryPart));
      if (matching.length === 0) return this.reply(`No tasks matching "${queryPart}".`);
      for (const task of matching) {
        let newRaw = task.raw;
        if (task.dueDate) {
          newRaw = newRaw.replace(/<!--\s*due:\d{4}-\d{2}-\d{2}\s*-->/, `<!-- due:${dateStr} -->`);
        } else {
          newRaw = newRaw.trimEnd() + ` <!-- due:${dateStr} -->`;
        }
        this.updateLine(task.filePath, task.lineNumber, newRaw);
      }
      return this.reply(`Moved ${matching.length} task(s) to next week (${dateStr}).`);
    }

    // -- Add task to file --
    const addMatch = lower.match(/^add ['"]?(.+?)['"]?\s+to\s+(\S+)/);
    if (addMatch) {
      const taskText = addMatch[1]!;
      const fileName = addMatch[2]!.endsWith(".md") ? addMatch[2]! : addMatch[2] + ".md";
      const filePath = join(this.config.watched_dir, fileName);
      try {
        let existing = "";
        try { existing = readFileSync(filePath, "utf-8"); } catch {}
        const line = `- [ ] ${taskText}\n`;
        const updated = existing ? existing.trimEnd() + "\n" + line : line;
        this.writeFileWithUndo(filePath, existing, updated, `add "${taskText}"`);
        return this.reply(`Added "${taskText}" to ${fileName}.`);
      } catch (err: any) {
        return this.reply(`Failed: ${err.message}`);
      }
    }

    // -- Quick stats --
    if (/overdue|what's overdue|what is overdue/.test(lower)) {
      const overdue = this.tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "done");
      if (overdue.length === 0) return this.reply("No overdue tasks!");
      const list = overdue.slice(0, 5).map(t => `${t.content} (${t.dueDate})`).join(", ");
      return this.reply(`${overdue.length} overdue: ${list}`);
    }

    if (/focus.*(today|now)|what should i/i.test(lower)) {
      const today = new Date().toISOString().slice(0, 10);
      const urgent = this.tasks.filter(t => t.status !== "done" && t.dueDate && t.dueDate <= today);
      const inProgress = this.tasks.filter(t => t.status === "in_progress");
      const items = [...urgent, ...inProgress].slice(0, 5);
      if (items.length === 0) return this.reply("Nothing urgent today. Pick something from your inbox!");
      const list = items.map(t => t.content).join(", ");
      return this.reply(`Focus on: ${list}`);
    }

    if (/summarize.*week|weekly|this week/i.test(lower)) {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
      const weekEnd = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
      const doneThisWeek = this.tasks.filter(t => t.doneDate && t.doneDate >= weekAgo);
      const dueThisWeek = this.tasks.filter(t => t.dueDate && t.dueDate >= weekAgo && t.dueDate <= weekEnd && t.status !== "done");
      return this.reply(`This week: ${doneThisWeek.length} completed, ${dueThisWeek.length} due. ${this.tasks.filter(t => t.status !== "done").length} total open.`);
    }

    if (/summary|summarize|how many/i.test(lower)) {
      const total = this.tasks.length;
      const done = this.tasks.filter(t => t.status === "done").length;
      const overdue = this.tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "done").length;
      const projects = new Set(this.tasks.map(t => t.project)).size;
      return this.reply(`${total} tasks across ${projects} projects. ${done} done, ${overdue} overdue, ${total - done} open.`);
    }

    // -- Color themes (Phase 4) --
    const themeMatch = lower.match(/^(theme|color|colour)\s+(default|warm|cool|mono)/);
    if (themeMatch) {
      this.colorTheme = themeMatch[2] as typeof this.colorTheme;
      this.persistPreferences();
      return this.reply(`Theme set to "${this.colorTheme}".`);
    }

    // -- Custom view creation (Phase 4) --
    if (/^create view\b/.test(lower)) {
      const desc = message.replace(/^create view\s*/i, "").trim();
      if (!desc) return this.reply("Usage: create view <description>. Example: create view priority by color");
      this.reply("Creating custom view...");
      try {
        const { generateCustomView } = await import("./categorizer");
        const viewDef = await generateCustomView(desc);
        const aiTasks = this.tasks.length > 200 ? this.tasks.slice(0, 200) : this.tasks;
        const buckets = await categorizeTasks("custom", aiTasks, viewDef.categorizationPrompt, this.config.ai_timeout_ms);
        this.customViews.push({
          name: viewDef.name,
          categorizationPrompt: viewDef.categorizationPrompt,
          buckets,
        });
        this.saveSessionState();
        this.buckets = buckets;
        this.chatMessages[this.chatMessages.length - 1] = { role: "ai", text: `Created "${viewDef.name}" view with ${Object.keys(buckets).length} groups.` };
        this.tui.invalidate();
        this.tui.requestRender();
      } catch (err: any) {
        this.chatMessages[this.chatMessages.length - 1] = { role: "ai", text: `Failed to create view: ${err.message}` };
        this.tui.invalidate();
        this.tui.requestRender();
      }
      return;
    }

    // -- Fallback: AI chat --
    this.chatMessages.push({ role: "ai", text: "Thinking..." });
    this.tui.invalidate();
    this.tui.requestRender();

    try {
      const taskCtx = this.tasks.slice(0, 50).map((t, i) => `${i + 1}. [${t.status}] ${t.content}${t.dueDate ? ` (due: ${t.dueDate})` : ""}`).join("\n");
      const result = await studioChat(message, this.activeView, {
        taskCount: this.tasks.length,
        doneCount: this.tasks.filter(t => t.status === "done").length,
        activeView: this.activeView,
        tasks: taskCtx,
      });
      this.chatMessages[this.chatMessages.length - 1] = {
        role: "ai",
        text: typeof result === "string" ? result : JSON.stringify(result),
      };
    } catch (err: any) {
      const total = this.tasks.length;
      const done = this.tasks.filter(t => t.status === "done").length;
      this.chatMessages[this.chatMessages.length - 1] = {
        role: "ai",
        text: `${total} tasks (${done} done). AI unavailable: ${err.message || "no auth"}`,
      };
    }
    this.saveSessionState();
    this.tui.invalidate();
    this.tui.requestRender();
  }

  private resolveDate(input: string): string {
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

  // -- Rendering --

  private renderTopBar(width: number): string[] {
    const compact = width < 100;
    const tabs = VIEWS.map(v => {
      const isActive = v.key === this.activeView;
      const label = compact ? v.num : `${v.num}:${v.label}`;
      return isActive ? this.theme.tabActive(` ${label} `) : this.theme.tab(` ${label} `);
    }).join("");
    const customKeys = ["8", "9", "0"];
    const customTabs = this.customViews.map((v, i) => {
      const key: ActiveViewName = `custom:${v.name}`;
      const hotkey = customKeys[i] ?? "C";
      const label = compact ? hotkey : `${hotkey}:${v.name}`;
      return this.activeView === key ? this.theme.tabActive(` ${label} `) : this.theme.tab(` ${label} `);
    }).join("");

    const visible = this.getVisibleTasks().length;
    const total = this.tasks.length;
    const countLabel = visible !== total ? `${visible}/${total} tasks` : `${total} tasks`;
    const count = chalk.dim(` ${countLabel} `);
    const folderName = this.config.watched_dir.split("/").pop() ?? this.config.watched_dir;
    const folder = chalk.dim(truncateToWidth(folderName, compact ? 12 : 24));

    let bar = `${folder} ${tabs}${customTabs}${count}`;
    if (this.searchFilter) bar += chalk.yellow(` /${this.searchFilter}`);
    if (this.hideDone) bar += chalk.dim(" [hide done]");
    if (this.statusMessage) bar += this.statusColor(`  ${this.statusMessage}`);
    if (visibleWidth(bar) > width) bar = truncateToWidth(bar, width);

    const separator = chalk.dim("─".repeat(width));
    const lines = [bar, separator];
    if (this.searchActive) {
      lines.push(chalk.yellow("  / search ") + this.renderBareInput(this.searchInput, Math.max(1, width - 12)));
    }
    if (this.addActive) {
      const target = basename(this.getQuickAddTargetFile());
      lines.push(chalk.green(`  + add to ${target}: `) + this.renderBareInput(this.addInput, Math.max(1, width - target.length - 12)));
    }
    if (this.editActive) {
      lines.push(chalk.cyan("  edit: ") + this.renderBareInput(this.editInput, Math.max(1, width - 8)));
    }
    return lines;
  }

  private getTaskPaneHeight(): number {
    return Math.max(this.terminal.rows - 8 - (this.searchActive ? 1 : 0) - (this.addActive ? 1 : 0) - (this.editActive ? 1 : 0), 10);
  }

  private renderTaskPane(width: number): string[] {
    if (this.searchActive) this.searchFilter = this.searchInput.getValue();
    const lines: string[] = [];
    const height = this.getTaskPaneHeight();

    if (this.helpOpen) {
      this.renderHelp(lines);
    } else {
      this.selectedLineIndex = 0;
      if (this.tasks.length === 0) {
        this.renderEmptyState(lines);
      } else if (this.activeView.startsWith("custom:")) {
        this.renderBucketSections(lines, width, Object.keys(this.buckets));
      } else {
        switch (this.activeView) {
          case "projects": this.renderProjectsView(lines, width); break;
          case "gtd": this.renderGtdView(lines, width); break;
          case "eisenhower": this.renderEisenhowerView(lines, width); break;
          case "kanban": this.renderKanbanView(lines, width); break;
          case "postit": this.renderPostitView(lines, width); break;
          case "calendar": this.renderCalendarView(lines, width); break;
          case "mindmap": this.renderMindmapView(lines, width); break;
        }
      }
    }


    // Pad to fill height
    while (lines.length < height) lines.push("");

    // Trim to height with scroll
    if (this.selectedLineIndex >= this.scrollOffset + height) {
      this.scrollOffset = this.selectedLineIndex - height + 1;
    }
    if (this.selectedLineIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedLineIndex;
    }

    const visible = lines.slice(this.scrollOffset, this.scrollOffset + height);
    visible.push(chalk.dim("─".repeat(width)));
    return visible;
  }

  private renderEmptyState(lines: string[]) {
    lines.push(chalk.bold.yellow("  No tasks found"));
    lines.push("");
    lines.push("  Press a to add a task to inbox.md.");
    lines.push("  Run with --reset to choose a different folder or parse mode.");
    lines.push("  Supported files include .md, .txt, .todo, and TODO/TASKS files.");
  }

  private pushTaskLine(lines: string[], task: Task, index: number, width: number, showSource = false) {
    if (index === this.selectedIndex) this.selectedLineIndex = lines.length;
    lines.push(this.renderTaskLine(task, index, width, showSource));
  }

  private renderHelp(lines: string[]) {
    lines.push(chalk.bold.cyan("  DadTodo Help"));
    lines.push("");
    lines.push("  1-7              switch views");
    lines.push("  8/9/0            switch saved custom views");
    lines.push("  j/k, arrows      move selection");
    lines.push("  PgUp/PgDn        jump by page");
    lines.push("  gg, G            jump to top/bottom");
    lines.push("  space/enter      toggle selected checkbox");
    lines.push("  c                convert selected item to checkbox");
    lines.push("  i                edit selected task text");
    lines.push("  e                open source in $EDITOR");
    lines.push("  m                mark/unmark for bulk actions");
    lines.push("  d or x, d/x      confirm delete selected/marked tasks");
    lines.push("  u                undo last file edit");
    lines.push("  a or n           quick-add a task to current file");
    lines.push("  [ and ]          calendar previous/next month");
    lines.push("  /                search");
    lines.push("  Tab              focus chat, PgUp/PgDn scroll chat");
    lines.push("  ?                toggle this help");
    lines.push("  q, q             quit");
    lines.push("");
    lines.push(chalk.bold("  Chat examples"));
    lines.push("  hide done / show done");
    lines.push("  sort by due date / sort by project");
    lines.push("  add \"call plumber\" to home.md");
    lines.push("  set due for plumber to tomorrow");
    lines.push("  tag task 3 with urgent");
    lines.push("  move marked to next week");
    lines.push("  summarize week");
  }

  private renderProjectsView(lines: string[], width: number) {
    const visible = this.getVisibleTasks();
    const groups = new Map<string, { task: Task; globalIdx: number }[]>();
    for (let i = 0; i < visible.length; i++) {
      const t = visible[i]!;
      const key = t.project || "Unsorted";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ task: t, globalIdx: i });
    }

    for (const [project, entries] of groups) {
      const doneCount = entries.filter(e => e.task.status === "done").length;
      lines.push(this.theme.heading(`  ${project}`) + this.theme.muted(` (${entries.length} tasks, ${doneCount} done)`));

      let currentHeading = "";
      for (const { task, globalIdx } of entries) {
        if (task.heading && task.heading !== currentHeading) {
          currentHeading = task.heading;
          lines.push(chalk.dim(`    ${currentHeading}`));
        }
        this.pushTaskLine(lines, task, globalIdx, width);
      }
      lines.push("");
    }
  }

  private renderBucketSections(lines: string[], width: number, order: string[], colors: Record<string, (s: string) => string> = {}) {
    const visibleIdx = this.getVisibleIndexMap();

    const renderBucket = (key: string, colorFn: (s: string) => string) => {
      const indices = this.buckets[key] ?? [];
      const filtered = this.filterBucketIndices(indices, visibleIdx);
      const label = key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      lines.push(colorFn(`  ${label}`) + chalk.dim(` (${filtered.length})`));

      const show = filtered.slice(0, 20);
      for (const idx of show) {
        const t = this.tasks[idx]!;
        this.pushTaskLine(lines, t, visibleIdx.get(t.id) ?? 0, width, true);
      }
      if (filtered.length > 20) {
        lines.push(chalk.dim(`      ... ${filtered.length - 20} more`));
      }
      lines.push("");
    };

    for (const key of order) renderBucket(key, colors[key] ?? chalk.bold.yellow);
    for (const key of Object.keys(this.buckets)) {
      if (!order.includes(key)) renderBucket(key, chalk.bold.yellow);
    }
  }

  private renderGtdView(lines: string[], width: number) {
    this.renderBucketSections(lines, width,
      ["inbox", "next_actions", "waiting_for", "someday_maybe", "done"],
      {
        inbox: chalk.bold.red,
        next_actions: chalk.bold.green,
        waiting_for: chalk.bold.yellow,
        someday_maybe: chalk.bold.blue,
        done: chalk.bold.dim,
      }
    );
  }

  private renderEisenhowerView(lines: string[], width: number) {
    const visibleIdx = this.getVisibleIndexMap();
    const filterBucket = (key: string) => this.filterBucketIndices(this.buckets[key] ?? [], visibleIdx);

    const half = Math.floor(width / 2) - 2;
    const pad = (s: string, w: number) => {
      const vw2 = visibleWidth(s);
      return s + " ".repeat(Math.max(0, w - vw2));
    };

    lines.push(chalk.dim(" ".repeat(Math.floor(half / 2))) + chalk.bold("URGENT") +
      chalk.dim(" ".repeat(Math.max(1, half - 10))) + chalk.bold("NOT URGENT"));
    lines.push(chalk.dim("  " + "─".repeat(half) + "┬" + "─".repeat(half)));

    const ui = filterBucket("urgent_important");
    const ini = filterBucket("important_not_urgent");
    const uni = filterBucket("urgent_not_important");
    const n = filterBucket("neither");

    const renderQuadrant = (left: number[], right: number[], leftLabel: string, rightLabel: string) => {
      lines.push(
        chalk.bold.red(`  ${leftLabel}`) + pad("", half - visibleWidth(leftLabel) - 2) +
        chalk.dim("│") +
        chalk.bold.blue(` ${rightLabel}`)
      );
      const maxRows = Math.max(left.length, right.length, 1);
      for (let r = 0; r < Math.min(maxRows, 8); r++) {
        const lTask = left[r] != null ? this.tasks[left[r]!] : null;
        const rTask = right[r] != null ? this.tasks[right[r]!] : null;
        const lIndex = lTask ? visibleIdx.get(lTask.id) ?? 0 : -1;
        const rIndex = rTask ? visibleIdx.get(rTask.id) ?? 0 : -1;
        if (lIndex === this.selectedIndex || rIndex === this.selectedIndex) this.selectedLineIndex = lines.length;
        const lStr = lTask ? `  ${this.taskCheckbox(lTask)} ${this.inlineTaskLabel(lTask, lIndex, half - 8)}` : "";
        const rStr = rTask ? ` ${this.taskCheckbox(rTask)} ${this.inlineTaskLabel(rTask, rIndex, half - 8)}` : "";
        lines.push(pad(lStr, half) + chalk.dim("│") + rStr);
      }
      if (left.length > 8 || right.length > 8) {
        const lMore = left.length > 8 ? chalk.dim(`  ... ${left.length - 8} more`) : "";
        const rMore = right.length > 8 ? chalk.dim(` ... ${right.length - 8} more`) : "";
        lines.push(pad(lMore, half) + chalk.dim("│") + rMore);
      }
    };

    renderQuadrant(ui, ini, "DO FIRST", "SCHEDULE");
    lines.push(chalk.dim("  " + "─".repeat(half) + "┼" + "─".repeat(half)));
    renderQuadrant(uni, n, "DELEGATE", "ELIMINATE");
    lines.push(chalk.dim("  " + "─".repeat(half) + "┴" + "─".repeat(half)));
    lines.push("");
  }

  private renderKanbanView(lines: string[], width: number) {
    this.renderBucketSections(lines, width,
      ["todo", "in_progress", "blocked", "done"],
      {
        todo: chalk.bold.cyan,
        in_progress: chalk.bold.yellow,
        blocked: chalk.bold.red,
        done: chalk.bold.green,
      }
    );
  }

  private renderPostitView(lines: string[], width: number) {
    const visibleIdx = this.getVisibleIndexMap();
    const entries = (Object.entries(this.buckets) as [string, number[]][])
      .map(([k, indices]) => [k, this.filterBucketIndices(indices, visibleIdx)] as [string, number[]])
      .filter(([, indices]) => indices.length > 0);
    if (entries.length === 0) { lines.push(chalk.dim("  No tasks.")); return; }

    const noteColors = [chalk.bgYellow.black, chalk.bgGreen.black, chalk.bgCyan.black, chalk.bgMagenta.white, chalk.bgBlue.white];
    const noteWidth = Math.min(20, Math.floor(width / 3) - 2);
    const cols = Math.max(1, Math.floor(width / (noteWidth + 3)));

    let col = 0;
    let noteLines: string[][] = [];
    let maxNoteHeight = 0;

    for (let ei = 0; ei < entries.length; ei++) {
      const [bucketName, indices] = entries[ei]!;
      const colorFn = noteColors[ei % noteColors.length]!;
      const label = bucketName.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

      const taskLines: string[] = [];
      taskLines.push(colorFn(" " + label.slice(0, noteWidth - 2).padEnd(noteWidth - 2) + " "));
      taskLines.push(colorFn(" ".repeat(noteWidth)));
      for (const idx of indices.slice(0, 6)) {
        const t = this.tasks[idx];
        if (t) {
          const taskIndex = visibleIdx.get(t.id) ?? 0;
          if (taskIndex === this.selectedIndex) this.selectedLineIndex = lines.length + taskLines.length;
          const marker = taskIndex === this.selectedIndex ? "> " : "";
          const txt = (marker + t.content).slice(0, noteWidth - 4);
          taskLines.push(colorFn(" " + txt.padEnd(noteWidth - 2) + " "));
        }
      }
      if (indices.length > 6) {
        taskLines.push(colorFn((" +" + (indices.length - 6) + " more").padEnd(noteWidth)));
      }
      taskLines.push(colorFn(" ".repeat(noteWidth)));

      noteLines.push(taskLines);
      if (taskLines.length > maxNoteHeight) maxNoteHeight = taskLines.length;
      col++;

      if (col >= cols || ei === entries.length - 1) {
        for (let row = 0; row < maxNoteHeight; row++) {
          let rowStr = "  ";
          for (const note of noteLines) {
            rowStr += (note[row] ?? " ".repeat(noteWidth)) + "  ";
          }
          lines.push(rowStr);
        }
        lines.push("");
        noteLines = [];
        maxNoteHeight = 0;
        col = 0;
      }
    }
  }

  private renderCalendarView(lines: string[], width: number) {
    const visibleIdx = this.getVisibleIndexMap();

    const today = new Date().toISOString().slice(0, 10);
    const monthAnchor = new Date();
    monthAnchor.setMonth(monthAnchor.getMonth() + this.calendarMonthOffset, 1);
    const monthStart = monthAnchor.toISOString().slice(0, 10);
    const monthEndDate = new Date(monthAnchor);
    monthEndDate.setMonth(monthEndDate.getMonth() + 1, 0);
    const monthEnd = monthEndDate.toISOString().slice(0, 10);
    const dated: [string, number[]][] = [];
    let undated: number[] = [];

    for (const [key, indices] of Object.entries(this.buckets) as [string, number[]][]) {
      const filtered = this.filterBucketIndices(indices, visibleIdx);
      if (filtered.length === 0) continue;
      if (key === "undated") undated = filtered;
      else if (key >= monthStart && key <= monthEnd) dated.push([key, filtered]);
    }
    dated.sort((a, b) => a[0].localeCompare(b[0]));
    lines.push(chalk.bold.cyan(`  ${this.calendarMonthLabel()}`) + chalk.dim("  [ and ] change month"));
    lines.push("");

    for (const [date, indices] of dated) {
      const d = new Date(date + "T00:00:00");
      const dayName = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      const isToday = date === today;
      const isPast = date < today;
      const label = isToday ? `TODAY - ${dayName}` : dayName;
      lines.push(isToday ? chalk.bold.bgGreen.black(` ${label} `) : isPast ? chalk.red(`  ${label}`) : chalk.bold.cyan(`  ${label}`));

      for (const idx of indices.slice(0, 20)) {
        const t = this.tasks[idx]!;
        this.pushTaskLine(lines, t, visibleIdx.get(t.id) ?? 0, width, true);
      }
      lines.push("");
    }

    if (undated.length > 0) {
      lines.push(chalk.dim(`  Undated (${undated.length} tasks)`));
      for (const idx of undated.slice(0, 10)) {
        const t = this.tasks[idx]!;
        this.pushTaskLine(lines, t, visibleIdx.get(t.id) ?? 0, width, true);
      }
      if (undated.length > 10) lines.push(chalk.dim(`      ... ${undated.length - 10} more`));
    }
  }

  private renderMindmapView(lines: string[], width: number) {
    const visibleIdx = this.getVisibleIndexMap();
    const entries = (Object.entries(this.buckets) as [string, number[]][])
      .map(([k, indices]) => [k, this.filterBucketIndices(indices, visibleIdx)] as [string, number[]])
      .filter(([, indices]) => indices.length > 0);
    if (entries.length === 0) { lines.push(chalk.dim("  No tasks.")); return; }

    lines.push(chalk.bold.cyan("  Goals"));
    for (let i = 0; i < entries.length; i++) {
      const [bucketName, indices] = entries[i]!;
      const isLast = i === entries.length - 1;
      const label = bucketName.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      const branch = isLast ? "  └──> " : "  ├──> ";
      const cont = isLast ? "       " : "  │    ";

      lines.push(chalk.yellow(branch) + chalk.bold(label) + chalk.dim(` (${indices.length})`));

      for (const idx of indices.slice(0, 8)) {
        const t = this.tasks[idx];
        if (t) {
          const check = this.taskCheckbox(t);
          const taskIndex = visibleIdx.get(t.id) ?? 0;
          if (taskIndex === this.selectedIndex) this.selectedLineIndex = lines.length;
          lines.push(chalk.yellow(cont) + `├── ${check} ${this.inlineTaskLabel(t, taskIndex, width - 20)}`);
        }
      }
      if (indices.length > 8) {
        lines.push(chalk.yellow(cont) + chalk.dim(`└── ... ${indices.length - 8} more`));
      }
      if (!isLast) lines.push(chalk.yellow("  │"));
    }
    lines.push("");
  }

  private taskCheckbox(task: Task): string {
    if (task.sourceType === "checkbox") {
      return task.status === "done" ? chalk.green("[x]") : task.status === "in_progress" ? chalk.yellow("[/]") : chalk.dim("[ ]");
    }
    return chalk.dim(" - ");
  }

  private taskWithSource(task: Task, maxWidth: number): string {
    const source = basename(task.filePath);
    const suffix = ` (${source})`;
    const room = Math.max(8, maxWidth - suffix.length);
    return `${task.content.slice(0, room)}${chalk.dim(suffix)}`;
  }

  private inlineTaskLabel(task: Task, index: number, maxWidth: number): string {
    const label = truncateToWidth(this.taskWithSource(task, maxWidth), maxWidth);
    if (index !== this.selectedIndex) return label;
    return this.theme.selected(`> ${label}`);
  }

  private renderTaskLine(task: Task, index: number, width: number, showSource = false): string {
    const isSelected = index === this.selectedIndex;
    const isMarked = this.selectedIds.has(task.id);
    const prefix = isSelected ? this.theme.accent("  > ") : isMarked ? chalk.green("  * ") : "    ";

    let checkbox: string;
    if (task.sourceType === "checkbox") {
      checkbox = task.status === "done" ? chalk.green("[x]") : task.status === "in_progress" ? chalk.yellow("[/]") : this.theme.muted("[ ]");
    } else {
      checkbox = this.theme.muted(" - ");
    }

    let content = task.content;
    if (task.status === "done") content = this.theme.done(content);
    else if (isSelected) content = this.theme.selected(content);

    let meta = "";
    if (task.dueDate) {
      const overdue = new Date(task.dueDate) < new Date();
      meta += overdue ? this.theme.overdue(` ${task.dueDate}`) : chalk.blue(` ${task.dueDate}`);
    }
    if (task.tags.length > 0) meta += chalk.magenta(` @${task.tags.join(" @")}`);
    if (showSource) meta += chalk.dim(` ${basename(task.filePath)}`);

    const line = `${prefix}${checkbox} ${content}${meta}`;
    const vw = visibleWidth(line);
    const pad = Math.max(0, width - vw);
    return isSelected ? chalk.bgGray(line + " ".repeat(pad)) : line;
  }

  private renderChatHistory(width: number): string[] {
    let historyLines: string[] = [];
    const maxLines = 4;

    for (const msg of this.chatMessages) {
      const prefix = msg.role === "user" ? chalk.dim("  you: ") : chalk.blue("  ai: ");
      const body = msg.role === "user" ? chalk.white(msg.text) : msg.text;
      const wrapped = wrapTextWithAnsi(body, Math.max(10, width - 8));
      wrapped.forEach((line, i) => {
        historyLines.push(i === 0 ? prefix + line : "      " + line);
      });
    }

    if (historyLines.length === 0) {
      historyLines.push(chalk.dim("  Tab to chat with Pi  |  ?: help  |  a: add  |  u: undo  |  q,q: quit"));
    }

    const maxOffset = Math.max(0, historyLines.length - maxLines);
    this.chatScrollOffset = Math.min(this.chatScrollOffset, maxOffset);
    const start = Math.max(0, historyLines.length - maxLines - this.chatScrollOffset);
    const lines = historyLines.slice(start, start + maxLines);
    if (this.chatScrollOffset > 0) {
      lines[0] = chalk.dim(`  ... ${this.chatScrollOffset} line(s) below ...`);
    }
    while (lines.length < maxLines) lines.push("");

    // Prompt line
    const promptPrefix = this.chatFocused ? chalk.blue("  > ") : chalk.dim("  > ");
    lines.push(promptPrefix);

    return lines;
  }

  stop() {
    this.watcher?.close();
    this.tui.stop();
    process.exit(0);
  }
}
