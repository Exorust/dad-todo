import React, { useState, useEffect, useRef, useCallback, Component, type ReactNode } from "react";
import { Box, Text, useInput, useStdout, useApp } from "ink";
import { parseAllFiles, parseOneFile, type Task } from "./parser.js";
import { categorizeTasks, generateCustomView, studioChat, type Buckets } from "./categorizer.js";
import { startWatcher } from "./watcher.js";
import type { DadTodoConfig } from "./config.js";
import { saveConfig } from "./config.js";
import { THEMES, getBuckets, getVisibleTasks, hashTasks, readCache, writeCache, fallbackCategorize } from "./taskHelpers.js";
import { handleChatMessage, type ChatContext } from "./chatCommands.js";
import { VIEWS, type ActiveViewName, type SortBy, type ThemeName, type UndoEntry, type StatusKind, type CustomView } from "./types.js";
import { TabBar } from "./components/TabBar.js";
import { TaskPane } from "./components/TaskPane.js";
import { ChatPane } from "./components/ChatPane.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import type { FSWatcher } from "node:fs";

// ARCH-4: Error boundary so a render crash doesn't kill the whole app
class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: Error) { return { error: err.message }; }
  render() {
    if (this.state.error) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text color="red" bold>Render error: {this.state.error}</Text>
          <Text dimColor>Press r to reload, q q to quit.</Text>
        </Box>
      );
    }
    return this.props.children;
  }
}

interface AppProps {
  config: DadTodoConfig;
  isDemo?: boolean;
}

function AppInner({ config: initialConfig, isDemo }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();

  // UX-1: Track terminal dimensions with resize listener
  const [termSize, setTermSize] = useState({ w: stdout?.columns ?? 80, h: stdout?.rows ?? 24 });
  useEffect(() => {
    const onResize = () => setTermSize({ w: stdout?.columns ?? 80, h: stdout?.rows ?? 24 });
    stdout?.on("resize", onResize);
    return () => { stdout?.off("resize", onResize); };
  }, [stdout]);
  const termWidth = termSize.w;
  const termHeight = termSize.h;

  const configRef = useRef(initialConfig);

  // -- State --
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeView, setActiveView] = useState<ActiveViewName>((initialConfig.last_view as ActiveViewName) ?? "today");
  const [buckets, setBuckets] = useState<Buckets>({});
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "ai"; text: string }[]>(initialConfig.chat_history ?? []);
  const [chatFocused, setChatFocused] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatScrollOffset, setChatScrollOffset] = useState(0);
  const [hideDone, setHideDone] = useState(initialConfig.preferences?.hideDone ?? false);
  const [sortBy, setSortBy] = useState<SortBy>(initialConfig.preferences?.sortBy ?? "default");
  const [searchFilter, setSearchFilter] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [colorTheme, setColorTheme] = useState<ThemeName>(initialConfig.preferences?.colorTheme ?? "default");
  const [customViews, setCustomViews] = useState<CustomView[]>(
    (initialConfig.custom_views ?? []).map(v => ({ name: v.name, categorizationPrompt: v.categorizationPrompt }))
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [statusKind, setStatusKind] = useState<StatusKind>("info");
  const [helpOpen, setHelpOpen] = useState(false);
  const [addActive, setAddActive] = useState(false);
  const [addValue, setAddValue] = useState("");
  const [editActive, setEditActive] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [calendarMonthOffset, setCalendarMonthOffset] = useState(0);
  const [selectedIds, setSelectedIds] = useState(new Set<string>());

  const undoStackRef = useRef<UndoEntry[]>([]);
  const watcherRef = useRef<FSWatcher | null>(null);
  const quitPendingRef = useRef(false);
  const gPendingRef = useRef(false);
  const gTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deletePendingRef = useRef(new Set<string>());
  const aiErrorShownRef = useRef(false);
  // ARCH-1/5: Ref for refreshFile so watcher and writeFileWithUndo always call latest version
  const refreshFileRef = useRef<(filePath: string, quiet?: boolean) => Promise<void>>(async () => {});
  const tasksRef = useRef<Task[]>([]);
  const bucketsRef = useRef<Buckets>({});
  const activeViewRef = useRef<ActiveViewName>(activeView);

  tasksRef.current = tasks;
  bucketsRef.current = buckets;
  activeViewRef.current = activeView;

  const theme = THEMES[colorTheme];

  // UX-4: Status messages auto-clear after 3s
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setStatus = useCallback((message: string, kind: StatusKind = "info") => {
    setStatusMessage(message);
    setStatusKind(kind);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    if (message) {
      statusTimerRef.current = setTimeout(() => {
        setStatusMessage("");
        statusTimerRef.current = null;
      }, 3000);
    }
  }, []);

  // -- Derived --
  const visible = getVisibleTasks(tasks, activeView, buckets, hideDone, projectFilter, searchFilter, sortBy);

  const clampSelection = useCallback((taskList: Task[], sel?: number) => {
    const count = getVisibleTasks(taskList, activeViewRef.current, bucketsRef.current, hideDone, projectFilter, searchFilter, sortBy).length;
    const current = sel ?? selectedIndex;
    if (current >= count) setSelectedIndex(count === 0 ? 0 : count - 1);
  }, [hideDone, projectFilter, searchFilter, sortBy, selectedIndex]);

  const getQuickAddTargetFile = useCallback((): string => {
    const vis = getVisibleTasks(tasksRef.current, activeViewRef.current, bucketsRef.current, hideDone, projectFilter, searchFilter, sortBy);
    return vis[selectedIndex]?.filePath ?? tasksRef.current[0]?.filePath ?? join(configRef.current.watched_dir, "inbox.md");
  }, [selectedIndex, hideDone, projectFilter, searchFilter, sortBy]);

  // -- File operations --
  const updateLine = useCallback((filePath: string, lineNumber: number, newContent: string, description = "edit task"): boolean => {
    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      if (lineNumber >= 1 && lineNumber <= lines.length) {
        lines[lineNumber - 1] = newContent;
        return writeFileWithUndo(filePath, content, lines.join("\n"), description);
      }
    } catch (err: any) {
      setStatus(`Write failed: ${err.message || String(err)}`, "error");
    }
    return false;
  }, []);

  const writeFileWithUndo = useCallback((filePath: string, before: string, after: string, description: string): boolean => {
    if (before === after) return false;
    try {
      writeFileSync(filePath, after, "utf-8");
      undoStackRef.current.push({ filePath, before, after, description });
      if (undoStackRef.current.length > 20) undoStackRef.current.shift();
      refreshFileRef.current(filePath, true);
      return true;
    } catch (err: any) {
      setStatus(`Write failed: ${err.message || String(err)}`, "error");
      return false;
    }
  }, []);

  const refreshFile = useCallback(async (filePath: string, quiet = false) => {
    const cfg = configRef.current;
    if (!existsSync(cfg.watched_dir)) {
      setStatus(`Folder missing: ${cfg.watched_dir}`, "error");
      setTasks([]);
      return;
    }
    const parsed = await parseOneFile(filePath, cfg.watched_dir, {
      fileTypes: cfg.file_types,
      parseMode: cfg.parse_mode,
    });
    setTasks(prev => {
      const next = [...prev.filter(t => t.filePath !== filePath), ...parsed]
        .sort((a, b) => a.filePath.localeCompare(b.filePath) || a.lineNumber - b.lineNumber);
      tasksRef.current = next;
      const b = getBuckets(activeViewRef.current, next);
      setBuckets(b);
      bucketsRef.current = b;
      return next;
    });
    if (!quiet) {
      setStatus(
        parsed.length > 0 ? `Updated ${basename(filePath)}` : `Removed tasks from ${basename(filePath)}`,
        parsed.length > 0 ? "success" : "warning",
      );
    }
  }, []);
  refreshFileRef.current = refreshFile;

  const undoLast = useCallback(() => {
    const entry = undoStackRef.current.pop();
    if (!entry) {
      setStatus("Nothing to undo", "info");
      return;
    }
    try {
      const current = existsSync(entry.filePath) ? readFileSync(entry.filePath, "utf-8") : "";
      if (current !== entry.after) {
        setStatus(`Undo skipped: ${basename(entry.filePath)} changed again`, "warning");
      } else {
        writeFileSync(entry.filePath, entry.before, "utf-8");
        setStatus(`Undid ${entry.description}`, "success");
        refreshFileRef.current(entry.filePath, true);
      }
    } catch (err: any) {
      setStatus(`Undo failed: ${err.message || String(err)}`, "error");
    }
  }, []);

  // -- Input overlay submit handlers --
  const onSearchSubmit = useCallback((value: string) => {
    setSearchFilter(value);
    setSearchActive(false);
  }, []);

  const onAddSubmit = useCallback((value: string) => {
    const text = value.trim();
    setAddActive(false);
    setAddValue("");
    if (text) {
      const targetFile = getQuickAddTargetFile();
      const before = existsSync(targetFile) ? readFileSync(targetFile, "utf-8") : "";
      const separator = before === "" || before.endsWith("\n") ? "" : "\n";
      const after = `${before}${separator}- [ ] ${text}\n`;
      if (writeFileWithUndo(targetFile, before, after, `add "${text}"`)) {
        setStatus(`Added "${text}" to ${basename(targetFile)} (u to undo)`, "success");
      }
    }
  }, [getQuickAddTargetFile, writeFileWithUndo]);

  const onEditSubmit = useCallback((value: string) => {
    const text = value.trim();
    setEditActive(false);
    setEditValue("");
    if (text) {
      const task = visible[selectedIndex];
      if (task) {
        const idx = task.raw.indexOf(task.content);
        const newRaw = idx >= 0
          ? task.raw.slice(0, idx) + text + task.raw.slice(idx + task.content.length)
          : task.raw.replace(/(.+)/, text);
        if (updateLine(task.filePath, task.lineNumber, newRaw, `edit "${task.content}"`)) {
          setStatus(`Edited "${task.content}" (u to undo)`, "success");
        }
      }
    }
  }, [visible, selectedIndex, updateLine]);

  const saveSessionState = useCallback(() => {
    const cfg = configRef.current;
    cfg.custom_views = customViews.map(v => ({ name: v.name, categorizationPrompt: v.categorizationPrompt }));
    cfg.chat_history = chatMessages.slice(-100);
    cfg.last_view = activeView;
    saveConfig(cfg);
  }, [customViews, chatMessages, activeView]);

  const persistPreferences = useCallback((overrides: { hideDone?: boolean; sortBy?: SortBy; colorTheme?: ThemeName } = {}) => {
    const cfg = configRef.current;
    cfg.preferences = {
      hideDone: overrides.hideDone ?? cfg.preferences?.hideDone ?? false,
      sortBy: overrides.sortBy ?? cfg.preferences?.sortBy ?? "default",
      colorTheme: overrides.colorTheme ?? cfg.preferences?.colorTheme ?? "default",
    };
    saveConfig(cfg);
  }, []);

  // -- View switching --
  const switchView = useCallback((view: ActiveViewName) => {
    setActiveView(view);
    activeViewRef.current = view;
    setSelectedIndex(0);
    setScrollOffset(0);
    if (view.startsWith("custom:")) {
      const name = view.slice("custom:".length);
      const custom = customViews.find(v => v.name === name);
      const b = custom?.buckets ?? fallbackCategorize("postit", tasksRef.current);
      setBuckets(b);
      bucketsRef.current = b;
      if (custom && !custom.buckets) {
        void refreshCustomView(custom);
      }
    } else {
      const b = getBuckets(view, tasksRef.current);
      setBuckets(b);
      bucketsRef.current = b;
    }
  }, [customViews]);

  const refreshCustomView = useCallback(async (custom: CustomView) => {
    try {
      const aiTasks = tasksRef.current.length > 200 ? tasksRef.current.slice(0, 200) : tasksRef.current;
      custom.buckets = await categorizeTasks("custom", aiTasks, custom.categorizationPrompt, configRef.current.ai_timeout_ms);
      if (activeViewRef.current === `custom:${custom.name}`) {
        setBuckets(custom.buckets);
        bucketsRef.current = custom.buckets;
      }
    } catch (err: any) {
      setStatus(`Custom view fallback: ${err.message || String(err)}`, "warning");
    }
  }, []);

  // -- Task mutations --
  const toggleSelected = useCallback(() => {
    const curIds = selectedIds;
    const marked = visible.filter(t => curIds.has(t.id));
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
        if (updateLine(task.filePath, task.lineNumber, newRaw, `toggle "${task.content}"`)) changed++;
      }
      setStatus(`Toggled ${changed} marked task(s) (u to undo)`, "success");
      return;
    }
    const task = visible[selectedIndex];
    if (!task) return;
    if (task.sourceType !== "checkbox") {
      setStatus("Selected item is not a checkbox. Press c to convert it.", "warning");
      return;
    }
    const newStatus = task.status === "done" ? "open" : "done";
    const marker = newStatus === "done" ? "x" : " ";
    const today = new Date().toISOString().slice(0, 10);
    let newRaw = task.raw.replace(/\[[ x/]\]/, `[${marker}]`);
    if (newStatus === "done" && !newRaw.includes("<!-- done:")) newRaw = newRaw.trimEnd() + ` <!-- done:${today} -->`;
    if (newStatus === "open") newRaw = newRaw.replace(/\s*<!--\s*done:\d{4}-\d{2}-\d{2}\s*-->/, "");
    updateLine(task.filePath, task.lineNumber, newRaw, `toggle "${task.content}"`);
    setStatus(`Marked "${task.content}" ${newStatus === "done" ? "done" : "open"} (u to undo)`, "success");
  }, [visible, selectedIndex, selectedIds, updateLine]);

  const convertSelected = useCallback(() => {
    const task = visible[selectedIndex];
    if (!task || task.sourceType === "checkbox") return;
    let newRaw: string;
    if (/^\s*[-*+]\s+/.test(task.raw)) {
      newRaw = task.raw.replace(/^(\s*[-*+])\s+/, "$1 [ ] ");
    } else if (/^\s*\d+[.)]\s+/.test(task.raw)) {
      newRaw = task.raw.replace(/^(\s*)\d+[.)]\s+/, "$1- [ ] ");
    } else {
      newRaw = task.raw.replace(/^(\s*)/, "$1- [ ] ");
    }
    updateLine(task.filePath, task.lineNumber, newRaw, `convert "${task.content}"`);
    setStatus(`Converted "${task.content}" to checkbox (u to undo)`, "success");
  }, [visible, selectedIndex, updateLine]);

  const deleteSelectedTasks = useCallback(() => {
    const marked = visible.filter(t => selectedIds.has(t.id));
    const targets = marked.length > 0 ? marked : visible[selectedIndex] ? [visible[selectedIndex]!] : [];
    if (targets.length === 0) {
      setStatus("No task selected", "warning");
      return;
    }
    const ids = new Set(targets.map(t => t.id));
    const samePending = targets.length === deletePendingRef.current.size
      && targets.every(t => deletePendingRef.current.has(t.id));
    if (!samePending) {
      deletePendingRef.current = ids;
      setStatus(`Press d again to delete ${targets.length} task(s). u can undo after delete.`, "warning");
      return;
    }
    const byFile = new Map<string, Task[]>();
    for (const task of targets) {
      if (!byFile.has(task.filePath)) byFile.set(task.filePath, []);
      byFile.get(task.filePath)!.push(task);
    }
    for (const [filePath, fileTasks] of byFile) {
      try {
        const before = readFileSync(filePath, "utf-8");
        const lines = before.split("\n");
        const lineNums = new Set(fileTasks.map(t => t.lineNumber));
        const after = lines.filter((_, i) => !lineNums.has(i + 1)).join("\n");
        writeFileWithUndo(filePath, before, after, `delete ${fileTasks.length} task(s)`);
      } catch (err: any) {
        setStatus(`Delete failed: ${err.message || String(err)}`, "error");
      }
    }
    setSelectedIds(new Set());
    deletePendingRef.current = new Set();
    setStatus(`Deleted ${targets.length} task(s) (u to undo)`, "success");
  }, [visible, selectedIndex, selectedIds, writeFileWithUndo]);

  const openInEditor = useCallback(() => {
    const task = visible[selectedIndex];
    if (!task) { setStatus("No task selected", "warning"); return; }
    const editor = process.env.EDITOR || process.env.VISUAL;
    if (!editor) { setStatus("Set $EDITOR to use open-in-editor", "warning"); return; }
    const args = editor.includes("vim") || editor.includes("nvim") || editor.includes("nano")
      ? [`+${task.lineNumber}`, task.filePath]
      : [task.filePath];
    // Pause Ink's raw mode so the editor can take over the terminal
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    const child = spawn(editor, args, { stdio: "inherit" });
    const restoreTerminal = () => {
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.resume();
    };
    child.on("exit", () => {
      restoreTerminal();
      void refreshFileRef.current(task.filePath);
    });
    child.on("error", (err) => {
      restoreTerminal();
      setStatus(`Editor failed: ${err.message}`, "error");
    });
    setStatus(`Opened ${basename(task.filePath)}:${task.lineNumber}`, "success");
  }, [visible, selectedIndex]);

  // -- Chat submit --
  const onChatSubmit = useCallback(async (value: string) => {
    const text = value.trim();
    if (!text) return;
    const newMessages = [...chatMessages, { role: "user" as const, text }];
    setChatMessages(newMessages);
    setChatScrollOffset(0);
    setChatInput("");

    const reply = (t: string) => {
      setChatMessages(prev => [...prev, { role: "ai" as const, text: t }]);
      setChatScrollOffset(0);
    };

    const ctx: ChatContext = {
      tasks: tasksRef.current,
      visibleTasks: getVisibleTasks(tasksRef.current, activeViewRef.current, bucketsRef.current, hideDone, projectFilter, searchFilter, sortBy),
      customViews,
      selectedIds,
      watchedDir: configRef.current.watched_dir,
      activeView: activeViewRef.current,
      aiTimeoutMs: configRef.current.ai_timeout_ms,
      reply,
      switchView,
      setHideDone: (v) => { setHideDone(v); persistPreferences({ hideDone: v }); },
      setSortBy: (v) => { setSortBy(v); persistPreferences({ sortBy: v }); },
      setProjectFilter,
      setSearchFilter,
      setTheme: (v) => { setColorTheme(v); persistPreferences({ colorTheme: v }); },
      updateLine,
      writeFileWithUndo,
      editTaskContent: (task, newText) => {
        const idx = task.raw.indexOf(task.content);
        const newRaw = idx >= 0
          ? task.raw.slice(0, idx) + newText + task.raw.slice(idx + task.content.length)
          : task.raw.replace(/(.+)/, newText);
        updateLine(task.filePath, task.lineNumber, newRaw, `edit "${task.content}"`);
      },
      createCustomView: async (desc) => {
        try {
          reply("Creating custom view...");
          const def = await generateCustomView(desc);
          const cv: CustomView = { name: def.name, categorizationPrompt: def.categorizationPrompt };
          setCustomViews(prev => [...prev.slice(0, 1), cv]);
          switchView(`custom:${def.name}`);
          reply(`Created "${def.name}" view. Press 9 or 0 to switch.`);
        } catch (err: any) {
          reply(`Failed to create view: ${err.message || String(err)}`);
        }
      },
      aiChat: async (message) => {
        try {
          const result = await studioChat(message, activeViewRef.current, {});
          reply(typeof result === "string" ? result : JSON.stringify(result));
        } catch (err: any) {
          const msg = err.message || String(err);
          if (msg.includes("already processing")) {
            setStatus("AI is busy, try again in a moment", "warning");
          } else {
            reply(`AI error: ${msg}`);
          }
        }
      },
    };

    await handleChatMessage(text, ctx);
  }, [chatMessages, hideDone, projectFilter, searchFilter, sortBy, customViews, selectedIds, switchView, updateLine, writeFileWithUndo, persistPreferences]);

  // -- Initial load --
  useEffect(() => {
    const cfg = configRef.current;
    (async () => {
      if (!existsSync(cfg.watched_dir)) {
        setStatus(`Folder missing: ${cfg.watched_dir}`, "error");
        return;
      }
      const parsed = await parseAllFiles(cfg.watched_dir, {
        fileTypes: cfg.file_types,
        parseMode: cfg.parse_mode,
      });
      setTasks(parsed);
      tasksRef.current = parsed;
      const b = getBuckets(activeViewRef.current, parsed);
      setBuckets(b);
      bucketsRef.current = b;

      if (!cfg.ai_configured) {
        setStatus("AI not configured; using rule-based views", "warning");
      }

      // Prefetch AI
      const hash = hashTasks(parsed);
      const aiViews = ["gtd", "eisenhower", "kanban", "postit", "calendar", "mindmap"];
      for (const view of aiViews) {
        const cached = readCache(view);
        if (cached && cached.hash === hash) continue;
        try {
          const aiTasks = parsed.length > 200 ? parsed.slice(0, 200) : parsed;
          const viewBuckets = await categorizeTasks(view, aiTasks, undefined, cfg.ai_timeout_ms);
          writeCache(view, hash, viewBuckets);
          if (activeViewRef.current === view) {
            setBuckets(viewBuckets);
            bucketsRef.current = viewBuckets;
          }
        } catch (err: any) {
          const msg = err.message || String(err);
          if (msg.includes("already processing")) continue;
          if (!aiErrorShownRef.current) {
            aiErrorShownRef.current = true;
            setStatus("AI unavailable; using fallback views", "warning");
          }
        }
      }
    })();

    // File watcher (ARCH-5: uses ref so it always calls latest refreshFile)
    try {
      watcherRef.current = startWatcher(cfg.watched_dir, cfg.file_types, async (filePath) => {
        await refreshFileRef.current(filePath);
      });
    } catch (err: any) {
      setStatus(`Watcher disabled: ${err.message || String(err)}`, "error");
    }

    return () => { watcherRef.current?.close(); };
  }, []);

  // UX-5: Debounce session saves (500ms) to avoid excessive disk I/O
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { saveSessionState(); }, 500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [chatMessages, activeView, customViews]);

  // -- Keyboard input --
  useInput((input, key) => {
    // Chat focused mode
    if (chatFocused) {
      if (key.pageUp) { setChatScrollOffset(prev => prev + 4); return; }
      if (key.pageDown) { setChatScrollOffset(prev => Math.max(0, prev - 4)); return; }
      if (key.escape) { setChatFocused(false); return; }
      return;
    }

    // Search/add/edit active: TextInput handles typing and submit,
    // useInput only handles escape to cancel
    if (searchActive) {
      if (key.escape) { setSearchActive(false); setSearchFilter(""); setSearchValue(""); }
      return;
    }
    if (addActive) {
      if (key.escape) { setAddActive(false); setAddValue(""); }
      return;
    }
    if (editActive) {
      if (key.escape) { setEditActive(false); setEditValue(""); }
      return;
    }

    // Normal mode
    if (input !== "q") quitPendingRef.current = false;
    if (input !== "g" && gPendingRef.current) {
      gPendingRef.current = false;
      if (gTimerRef.current) clearTimeout(gTimerRef.current);
      gTimerRef.current = null;
    }
    if (input !== "d" && input !== "x") deletePendingRef.current = new Set();

    if (input === "?") { setHelpOpen(h => !h); return; }
    if (input === "u") { undoLast(); return; }
    if (input === "m") {
      const task = visible[selectedIndex];
      if (!task) return;
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(task.id)) {
          next.delete(task.id);
          setStatus(`Unmarked "${task.content}"`, "info");
        } else {
          next.add(task.id);
          setStatus(`Marked ${next.size} task(s)`, "success");
        }
        return next;
      });
      return;
    }
    if (input === "i") {
      const task = visible[selectedIndex];
      if (!task) { setStatus("No task selected", "warning"); return; }
      setEditActive(true);
      setEditValue(task.content);
      return;
    }
    if (input === "e") { openInEditor(); return; }
    if (input === "d" || input === "x") { deleteSelectedTasks(); return; }
    if (activeView === "calendar" && (input === "[" || input === "]")) {
      setCalendarMonthOffset(prev => prev + (input === "]" ? 1 : -1));
      setScrollOffset(0);
      return;
    }
    if (input === "a" || input === "n") {
      setAddActive(true);
      setAddValue("");
      return;
    }

    // View switch keys
    for (const v of VIEWS) {
      if (input === v.num) { switchView(v.key); return; }
    }
    const customKeyIndex = ["9", "0"].indexOf(input);
    if (customKeyIndex !== -1 && customViews[customKeyIndex]) {
      switchView(`custom:${customViews[customKeyIndex]!.name}`);
      return;
    }

    // Navigation
    if (input === "j" || key.downArrow) {
      setSelectedIndex(prev => visible.length === 0 ? 0 : Math.min(prev + 1, visible.length - 1));
      return;
    }
    if (key.pageDown) {
      const step = Math.max(5, taskPaneHeight - 2);
      setSelectedIndex(prev => visible.length === 0 ? 0 : Math.min(prev + step, visible.length - 1));
      return;
    }
    if (input === "G") {
      setSelectedIndex(visible.length === 0 ? 0 : visible.length - 1);
      return;
    }
    if (input === "g") {
      if (gPendingRef.current) {
        setScrollOffset(0);
        setSelectedIndex(0);
        gPendingRef.current = false;
        if (gTimerRef.current) clearTimeout(gTimerRef.current);
        gTimerRef.current = null;
      } else {
        gPendingRef.current = true;
        setStatus("Press g again within 1s for top", "info");
        gTimerRef.current = setTimeout(() => {
          gPendingRef.current = false;
          gTimerRef.current = null;
          setStatus("", "info");
        }, 1000);
      }
      return;
    }
    if (input === "k" || key.upArrow) {
      setSelectedIndex(prev => Math.max(prev - 1, 0));
      return;
    }
    if (key.pageUp) {
      const step = Math.max(5, taskPaneHeight - 2);
      setSelectedIndex(prev => Math.max(prev - step, 0));
      return;
    }
    if (input === " " || key.return) { toggleSelected(); return; }
    if (input === "c") { convertSelected(); return; }
    // UX-3: Tab toggles chat focus
    if (key.tab) { setChatFocused(f => !f); return; }
    if (input === "/") {
      setSearchActive(true);
      setSearchValue("");
      return;
    }
    if (input === "r") {
      (async () => {
        const parsed = await parseAllFiles(configRef.current.watched_dir, {
          fileTypes: configRef.current.file_types,
          parseMode: configRef.current.parse_mode,
        });
        setTasks(parsed);
        tasksRef.current = parsed;
        const b = getBuckets(activeViewRef.current, parsed);
        setBuckets(b);
        bucketsRef.current = b;
        setStatus("Reloaded", "success");
      })();
      return;
    }
    if (input === "q") {
      if (quitPendingRef.current) { exit(); return; }
      quitPendingRef.current = true;
      setStatus("Press q again to quit", "warning");
      return;
    }
  });

  // -- Layout --
  // TabBar: ~2 lines, ChatPane: ~6 lines (4 history + separator + input), rest is TaskPane
  const taskPaneHeight = Math.max(3, termHeight - 9);

  return (
    <Box flexDirection="column" width={termWidth} height={termHeight}>
      <TabBar
        activeView={activeView}
        customViews={customViews}
        visibleCount={visible.length}
        totalCount={tasks.length}
        folderName={isDemo ? "DEMO" : basename(configRef.current.watched_dir)}
        searchFilter={searchFilter}
        hideDone={hideDone}
        statusMessage={statusMessage}
        statusKind={statusKind}
        theme={theme}
        searchActive={searchActive}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        onSearchSubmit={onSearchSubmit}
        addActive={addActive}
        addTargetFile={basename(getQuickAddTargetFile())}
        addValue={addValue}
        onAddChange={setAddValue}
        onAddSubmit={onAddSubmit}
        editActive={editActive}
        editValue={editValue}
        onEditChange={setEditValue}
        onEditSubmit={onEditSubmit}
        width={termWidth}
      />
      <TaskPane
        tasks={tasks}
        visibleTasks={visible}
        activeView={activeView}
        buckets={buckets}
        selectedIndex={selectedIndex}
        selectedIds={selectedIds}
        theme={theme}
        height={taskPaneHeight}
        width={termWidth}
        helpOpen={helpOpen}
        scrollOffset={scrollOffset}
        calendarMonthOffset={calendarMonthOffset}
        onScrollChange={setScrollOffset}
      />
      <ChatPane
        messages={chatMessages}
        focused={chatFocused}
        inputValue={chatInput}
        onInputChange={setChatInput}
        onSubmit={(v) => { void onChatSubmit(v); }}
        scrollOffset={chatScrollOffset}
        width={termWidth}
      />
    </Box>
  );
}

// ARCH-4: Wrap in error boundary
export function App(props: AppProps) {
  return (
    <ErrorBoundary>
      <AppInner {...props} />
    </ErrorBoundary>
  );
}
