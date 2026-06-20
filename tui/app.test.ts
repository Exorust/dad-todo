import { test, expect, describe } from "bun:test";
import type { Task } from "./parser";
import { fallbackCategorize } from "./taskHelpers";

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

describe("fallback categorizer (via taskHelpers import)", () => {
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
