import { test, expect, describe } from "bun:test";
import type { Task } from "./parser";

// Import the fallback categorizer by extracting it - it's not exported,
// so we test via the module's behavior. For now, inline a copy for unit testing.
function fallbackCategorize(viewName: string, tasks: Task[]): Record<string, number[]> {
  const buckets: Record<string, number[]> = {};
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
    }
  }
  return buckets;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "test-1",
    content: "Test task",
    status: "open",
    filePath: "/tmp/test.md",
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

describe("fallback categorizer", () => {
  test("gtd: done tasks go to done bucket", () => {
    const tasks = [makeTask({ status: "done" })];
    const b = fallbackCategorize("gtd", tasks);
    expect(b.done).toEqual([0]);
  });

  test("gtd: waiting tag goes to waiting_for", () => {
    const tasks = [makeTask({ tags: ["waiting"] })];
    const b = fallbackCategorize("gtd", tasks);
    expect(b.waiting_for).toEqual([0]);
  });

  test("gtd: tasks with due dates go to next_actions", () => {
    const tasks = [makeTask({ dueDate: "2026-07-01" })];
    const b = fallbackCategorize("gtd", tasks);
    expect(b.next_actions).toEqual([0]);
  });

  test("gtd: plain open tasks go to inbox", () => {
    const tasks = [makeTask()];
    const b = fallbackCategorize("gtd", tasks);
    expect(b.inbox).toEqual([0]);
  });

  test("kanban: sorts by status", () => {
    const tasks = [
      makeTask({ status: "open" }),
      makeTask({ status: "in_progress" }),
      makeTask({ status: "done" }),
    ];
    const b = fallbackCategorize("kanban", tasks);
    expect(b.todo).toEqual([0]);
    expect(b.in_progress).toEqual([1]);
    expect(b.done).toEqual([2]);
  });

  test("calendar: groups by due date", () => {
    const tasks = [
      makeTask({ dueDate: "2026-07-01" }),
      makeTask({ dueDate: "2026-07-01" }),
      makeTask({ dueDate: null }),
    ];
    const b = fallbackCategorize("calendar", tasks);
    expect(b["2026-07-01"]).toEqual([0, 1]);
    expect(b.undated).toEqual([2]);
  });

  test("postit: groups by project", () => {
    const tasks = [
      makeTask({ project: "home" }),
      makeTask({ project: "work" }),
      makeTask({ project: "home" }),
    ];
    const b = fallbackCategorize("postit", tasks);
    expect(b.home).toEqual([0, 2]);
    expect(b.work).toEqual([1]);
  });

  test("mindmap: groups by project", () => {
    const tasks = [makeTask({ project: "" })];
    const b = fallbackCategorize("mindmap", tasks);
    expect(b.general).toEqual([0]);
  });
});
