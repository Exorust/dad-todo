import { test, expect, describe } from "bun:test";
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { handleChatMessage, type ChatContext } from "./chatCommands";
import type { Task } from "./parser";
import type { ActiveViewName, SortBy, ThemeName, CustomView } from "./types";

const TMP = join(import.meta.dir, ".test-chatcmd-tmp");

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Math.random().toString(36).slice(2, 8)}`,
    content: "Test task",
    status: "open",
    filePath: join(TMP, "test.md"),
    lineNumber: 1,
    project: "test",
    heading: "",
    dueDate: null,
    doneDate: null,
    tags: [],
    raw: "- [ ] Test task",
    sourceType: "checkbox",
    ...overrides,
  };
}

interface TestState {
  replies: string[];
  switched: string[];
  lastHideDone: boolean | null;
  lastSortBy: SortBy | null;
  lastTheme: ThemeName | null;
  lastProjectFilter: string | null;
  lastSearchFilter: string | null;
  aiChatCalled: string | null;
}

function makeCtx(overrides: Partial<ChatContext> = {}): ChatContext & TestState {
  const state: TestState = {
    replies: [],
    switched: [],
    lastHideDone: null,
    lastSortBy: null,
    lastTheme: null,
    lastProjectFilter: null,
    lastSearchFilter: null,
    aiChatCalled: null,
  };
  const ctx: ChatContext = {
    tasks: [],
    visibleTasks: [],
    customViews: [],
    selectedIds: new Set<string>(),
    watchedDir: TMP,
    activeView: "today",
    reply: (text: string) => { state.replies.push(text); },
    switchView: (view: ActiveViewName) => { state.switched.push(view); },
    setHideDone: (v: boolean) => { state.lastHideDone = v; },
    setSortBy: (v: SortBy) => { state.lastSortBy = v; },
    setProjectFilter: (v: string) => { state.lastProjectFilter = v; },
    setSearchFilter: (v: string) => { state.lastSearchFilter = v; },
    setTheme: (v: ThemeName) => { state.lastTheme = v; },
    updateLine: () => true,
    writeFileWithUndo: () => true,
    editTaskContent: () => {},
    createCustomView: async () => {},
    aiChat: async (msg: string) => { state.aiChatCalled = msg; },
    ...overrides,
  };
  // Return a proxy that delegates state reads to the mutable state object
  return new Proxy(ctx as ChatContext & TestState, {
    get(target, prop) {
      if (prop in state) return state[prop as keyof TestState];
      return (target as any)[prop];
    },
  });
}

function setup() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  writeFileSync(join(TMP, "test.md"), "# Tasks\n- [ ] Buy milk\n- [x] Walk dog <!-- done:2026-06-20 -->\n- [ ] Fix faucet <!-- due:2026-06-15 -->\n");
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true });
}

// -- View switching --

describe("view switch commands", () => {
  test("'switch to kanban' switches view", async () => {
    const ctx = makeCtx();
    await handleChatMessage("switch to kanban", ctx);
    expect(ctx.switched).toContain("kanban");
    expect(ctx.replies.length).toBeGreaterThan(0);
  });

  test("'today' switches to today view", async () => {
    const ctx = makeCtx();
    await handleChatMessage("today", ctx);
    expect(ctx.switched).toContain("today");
  });

  test("'gtd' switches to gtd view", async () => {
    const ctx = makeCtx();
    await handleChatMessage("gtd", ctx);
    expect(ctx.switched).toContain("gtd");
  });

  test("'eisenhower' switches view", async () => {
    const ctx = makeCtx();
    await handleChatMessage("eisenhower", ctx);
    expect(ctx.switched).toContain("eisenhower");
  });

  test("all 8 view names work", async () => {
    for (const name of ["today", "projects", "gtd", "eisenhower", "kanban", "postit", "calendar", "mindmap"]) {
      const ctx = makeCtx();
      await handleChatMessage(name, ctx);
      expect(ctx.switched.length).toBe(1);
    }
  });

  test("custom view by name", async () => {
    const ctx = makeCtx({ customViews: [{ name: "Priority", categorizationPrompt: "test" }] });
    await handleChatMessage("Priority", ctx);
    expect(ctx.switched).toContain("custom:Priority");
  });
});

// -- Hide/show done --

describe("hide/show done", () => {
  test("'hide done' sets hideDone true", async () => {
    const ctx = makeCtx();
    await handleChatMessage("hide done", ctx);
    expect(ctx.lastHideDone).toBe(true);
    expect(ctx.replies[0]).toContain("Hiding");
  });

  test("'show done' sets hideDone false", async () => {
    const ctx = makeCtx();
    await handleChatMessage("show done", ctx);
    expect(ctx.lastHideDone).toBe(false);
  });

  test("'show all' sets hideDone false", async () => {
    const ctx = makeCtx();
    await handleChatMessage("show all", ctx);
    expect(ctx.lastHideDone).toBe(false);
  });
});

// -- Sort commands --

describe("sort commands", () => {
  test("'sort by due date' sets sortBy to due", async () => {
    const ctx = makeCtx();
    await handleChatMessage("sort by due date", ctx);
    expect(ctx.lastSortBy).toBe("due");
  });

  test("'sort by status' sets sortBy to status", async () => {
    const ctx = makeCtx();
    await handleChatMessage("sort by status", ctx);
    expect(ctx.lastSortBy).toBe("status");
  });

  test("'sort by project' sets sortBy to project", async () => {
    const ctx = makeCtx();
    await handleChatMessage("sort by project", ctx);
    expect(ctx.lastSortBy).toBe("project");
  });

  test("'reset sort' sets sortBy to default", async () => {
    const ctx = makeCtx();
    await handleChatMessage("reset sort", ctx);
    expect(ctx.lastSortBy).toBe("default");
  });

  test("'group by file' switches to projects view", async () => {
    const ctx = makeCtx();
    await handleChatMessage("group by file", ctx);
    expect(ctx.switched).toContain("projects");
  });
});

// -- Filter commands --

describe("filter commands", () => {
  test("'show only home' sets project filter", async () => {
    const ctx = makeCtx();
    await handleChatMessage("show only home", ctx);
    expect(ctx.lastProjectFilter).toBe("home");
  });

  test("'clear filter' clears both filters", async () => {
    const ctx = makeCtx();
    await handleChatMessage("clear filter", ctx);
    expect(ctx.lastProjectFilter).toBe("");
    expect(ctx.lastSearchFilter).toBe("");
  });
});

// -- Edit by number --

describe("edit by number", () => {
  test("'edit task 1 to new text' edits the task", async () => {
    const task = makeTask({ content: "Buy milk" });
    let editedTask: Task | null = null;
    let editedText = "";
    const ctx = makeCtx({
      visibleTasks: [task],
      editTaskContent: (t, text) => { editedTask = t; editedText = text; },
    });
    await handleChatMessage("edit task 1 to buy cheese", ctx);
    expect(editedTask!.id).toBe(task.id);
    expect(editedText).toBe("buy cheese");
    expect(ctx.replies[0]).toContain("Edited");
  });

  test("'edit task 99' with no such task shows error", async () => {
    const ctx = makeCtx({ visibleTasks: [] });
    await handleChatMessage("edit task 99 to something", ctx);
    expect(ctx.replies[0]).toContain("No task #99");
  });
});

// -- Delete by number --

describe("delete by number", () => {
  test("'delete task 1' deletes the task", async () => {
    setup();
    const task = makeTask({ content: "Buy milk", lineNumber: 2 });
    let undoCalled = false;
    const ctx = makeCtx({
      visibleTasks: [task],
      writeFileWithUndo: () => { undoCalled = true; return true; },
    });
    await handleChatMessage("delete task 1", ctx);
    expect(ctx.replies[0]).toContain("Deleted");
    teardown();
  });

  test("'delete task 99' shows error", async () => {
    const ctx = makeCtx({ visibleTasks: [] });
    await handleChatMessage("delete task 99", ctx);
    expect(ctx.replies[0]).toContain("No task #99");
  });
});

// -- Tag/untag --

describe("tag/untag", () => {
  test("'tag task 1 with urgent' calls updateLine", async () => {
    const task = makeTask({ content: "Buy milk", tags: [] });
    let lineUpdated = false;
    const ctx = makeCtx({
      visibleTasks: [task],
      updateLine: () => { lineUpdated = true; return true; },
    });
    await handleChatMessage("tag task 1 with urgent", ctx);
    expect(lineUpdated).toBe(true);
    expect(ctx.replies[0]).toContain("Tagged");
  });

  test("'untag task 1 from urgent' calls updateLine", async () => {
    const task = makeTask({ content: "Buy milk", tags: ["urgent"] });
    let lineUpdated = false;
    const ctx = makeCtx({
      visibleTasks: [task],
      updateLine: () => { lineUpdated = true; return true; },
    });
    await handleChatMessage("untag task 1 from urgent", ctx);
    expect(lineUpdated).toBe(true);
    expect(ctx.replies[0]).toContain("Untagged");
  });
});

// -- Mark done/open --

describe("mark done/open", () => {
  test("'mark task 1 done' marks checkbox done", async () => {
    const task = makeTask({ content: "Buy milk", sourceType: "checkbox", raw: "- [ ] Buy milk" });
    let lineUpdated = false;
    const ctx = makeCtx({
      visibleTasks: [task],
      updateLine: () => { lineUpdated = true; return true; },
    });
    await handleChatMessage("mark task 1 done", ctx);
    expect(lineUpdated).toBe(true);
    expect(ctx.replies[0]).toContain("done");
  });

  test("'mark task 1 open' reopens task", async () => {
    const task = makeTask({ content: "Buy milk", status: "done", sourceType: "checkbox", raw: "- [x] Buy milk" });
    let updatedRaw = "";
    const ctx = makeCtx({
      visibleTasks: [task],
      updateLine: (_fp, _ln, raw) => { updatedRaw = raw; return true; },
    });
    await handleChatMessage("mark task 1 open", ctx);
    expect(ctx.replies[0]).toContain("open");
  });

  test("mark non-checkbox shows helpful message", async () => {
    const task = makeTask({ sourceType: "bullet" });
    const ctx = makeCtx({ visibleTasks: [task] });
    await handleChatMessage("mark task 1 done", ctx);
    expect(ctx.replies[0]).toContain("not a checkbox");
  });

  test("mark out-of-range task shows error", async () => {
    const ctx = makeCtx({ visibleTasks: [makeTask()] });
    await handleChatMessage("mark task 5 done", ctx);
    expect(ctx.replies[0]).toContain("No task #5");
  });
});

// -- Set due date --

describe("set due date", () => {
  test("'set due for milk to tomorrow' sets due date", async () => {
    const task = makeTask({ content: "Buy milk", dueDate: null, raw: "- [ ] Buy milk" });
    let updatedRaw = "";
    const ctx = makeCtx({
      tasks: [task],
      updateLine: (_fp, _ln, raw) => { updatedRaw = raw; return true; },
    });
    await handleChatMessage("set due for milk to tomorrow", ctx);
    expect(ctx.replies[0]).toContain("Set due date");
  });

  test("set due for nonexistent task shows error", async () => {
    const ctx = makeCtx({ tasks: [] });
    await handleChatMessage("set due for unicorn to tomorrow", ctx);
    expect(ctx.replies[0]).toContain("No task matching");
  });
});

// -- Move to next week --

describe("move to next week", () => {
  test("'move marked to next week' with no marked shows error", async () => {
    const ctx = makeCtx({ visibleTasks: [makeTask()], selectedIds: new Set() });
    await handleChatMessage("move marked to next week", ctx);
    expect(ctx.replies[0]).toContain("No marked tasks");
  });

  test("'move marked to next week' updates marked tasks", async () => {
    const task = makeTask({ id: "t1", content: "Buy milk", raw: "- [ ] Buy milk" });
    let lineUpdated = false;
    const ctx = makeCtx({
      visibleTasks: [task],
      selectedIds: new Set(["t1"]),
      updateLine: () => { lineUpdated = true; return true; },
    });
    await handleChatMessage("move marked to next week", ctx);
    expect(lineUpdated).toBe(true);
    expect(ctx.replies[0]).toContain("Moved");
  });
});

// -- Add to file --

describe("add to file", () => {
  test("'add call plumber to home.md' creates task", async () => {
    setup();
    let writtenAfter = "";
    const ctx = makeCtx({
      writeFileWithUndo: (_fp, _before, after) => { writtenAfter = after; return true; },
    });
    await handleChatMessage('add "call plumber" to home.md', ctx);
    expect(ctx.replies[0]).toContain("Added");
    expect(ctx.replies[0]).toContain("call plumber");
    teardown();
  });

  test("'add task to file' without .md appends .md", async () => {
    setup();
    const ctx = makeCtx({
      writeFileWithUndo: () => true,
    });
    await handleChatMessage('add "new task" to inbox', ctx);
    expect(ctx.replies[0]).toContain("inbox.md");
    teardown();
  });
});

// -- Quick stats --

describe("quick stats", () => {
  test("'overdue' with no overdue tasks", async () => {
    const ctx = makeCtx({ tasks: [makeTask({ dueDate: "2099-01-01" })] });
    await handleChatMessage("overdue", ctx);
    expect(ctx.replies[0]).toContain("No overdue");
  });

  test("'overdue' with overdue tasks", async () => {
    const ctx = makeCtx({ tasks: [makeTask({ dueDate: "2020-01-01", content: "old task" })] });
    await handleChatMessage("overdue", ctx);
    expect(ctx.replies[0]).toContain("1 overdue");
  });

  test("'focus today' with nothing urgent", async () => {
    const ctx = makeCtx({ tasks: [makeTask({ dueDate: "2099-01-01" })] });
    await handleChatMessage("focus today", ctx);
    expect(ctx.replies[0]).toContain("Nothing urgent");
  });

  test("'summary' gives task counts", async () => {
    const ctx = makeCtx({
      tasks: [
        makeTask({ status: "open" }),
        makeTask({ status: "done" }),
        makeTask({ status: "open", dueDate: "2020-01-01" }),
      ],
    });
    await handleChatMessage("summary", ctx);
    expect(ctx.replies[0]).toContain("3 tasks");
    expect(ctx.replies[0]).toContain("1 done");
  });

  test("'summarize week' gives weekly counts", async () => {
    const ctx = makeCtx({ tasks: [makeTask()] });
    await handleChatMessage("summarize week", ctx);
    expect(ctx.replies[0]).toContain("This week");
  });
});

// -- Theme --

describe("theme", () => {
  test("'theme warm' sets warm theme", async () => {
    const ctx = makeCtx();
    await handleChatMessage("theme warm", ctx);
    expect(ctx.lastTheme).toBe("warm");
  });

  test("'theme cool' sets cool theme", async () => {
    const ctx = makeCtx();
    await handleChatMessage("theme cool", ctx);
    expect(ctx.lastTheme).toBe("cool");
  });

  test("'color mono' sets mono theme", async () => {
    const ctx = makeCtx();
    await handleChatMessage("color mono", ctx);
    expect(ctx.lastTheme).toBe("mono");
  });
});

// -- Create view --

describe("create view", () => {
  test("'create view' without description shows usage", async () => {
    const ctx = makeCtx();
    await handleChatMessage("create view", ctx);
    expect(ctx.replies[0]).toContain("Usage");
  });

  test("'create view priority' calls createCustomView", async () => {
    let viewDesc = "";
    const ctx = makeCtx({
      createCustomView: async (desc) => { viewDesc = desc; },
    });
    await handleChatMessage("create view priority by urgency", ctx);
    expect(viewDesc).toBe("priority by urgency");
  });
});

// -- AI fallback --

describe("AI fallback", () => {
  test("unrecognized input calls aiChat", async () => {
    const ctx = makeCtx();
    await handleChatMessage("what is the meaning of life", ctx);
    expect(ctx.aiChatCalled).toBe("what is the meaning of life");
  });
});
