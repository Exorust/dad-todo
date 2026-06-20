import { test, expect, describe } from "bun:test";
import type { Task } from "./parser";
import {
  fallbackCategorize,
  resolveDate,
  getVisibleTasks,
  hashTasks,
  taskSearchText,
  filterBucketIndices,
} from "./taskHelpers";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Math.random().toString(36).slice(2, 8)}`,
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

// -- fallbackCategorize --

describe("fallbackCategorize", () => {
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

  test("gtd: someday heading goes to someday_maybe", () => {
    const tasks = [makeTask({ heading: "Someday / Maybe" })];
    const b = fallbackCategorize("gtd", tasks);
    expect(b.someday_maybe).toEqual([0]);
  });

  test("gtd: due date goes to next_actions", () => {
    const tasks = [makeTask({ dueDate: "2026-07-01" })];
    const b = fallbackCategorize("gtd", tasks);
    expect(b.next_actions).toEqual([0]);
  });

  test("gtd: in_progress goes to next_actions", () => {
    const tasks = [makeTask({ status: "in_progress" })];
    const b = fallbackCategorize("gtd", tasks);
    expect(b.next_actions).toEqual([0]);
  });

  test("gtd: plain open tasks go to inbox", () => {
    const tasks = [makeTask()];
    const b = fallbackCategorize("gtd", tasks);
    expect(b.inbox).toEqual([0]);
  });

  test("eisenhower: near due date goes to urgent_important", () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const tasks = [makeTask({ dueDate: tomorrow })];
    const b = fallbackCategorize("eisenhower", tasks);
    expect(b.urgent_important).toEqual([0]);
  });

  test("eisenhower: far due date goes to important_not_urgent", () => {
    const farAway = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const tasks = [makeTask({ dueDate: farAway })];
    const b = fallbackCategorize("eisenhower", tasks);
    expect(b.important_not_urgent).toEqual([0]);
  });

  test("eisenhower: no due date goes to neither", () => {
    const tasks = [makeTask({ dueDate: null })];
    const b = fallbackCategorize("eisenhower", tasks);
    expect(b.neither).toEqual([0]);
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
      makeTask({ project: "" }),
    ];
    const b = fallbackCategorize("postit", tasks);
    expect(b.home).toEqual([0]);
    expect(b.work).toEqual([1]);
    expect(b.other).toEqual([2]);
  });

  test("mindmap: empty project goes to general", () => {
    const tasks = [makeTask({ project: "" })];
    const b = fallbackCategorize("mindmap", tasks);
    expect(b.general).toEqual([0]);
  });

  test("unknown view puts everything in 'all'", () => {
    const tasks = [makeTask(), makeTask()];
    const b = fallbackCategorize("unknown_view", tasks);
    expect(b.all).toEqual([0, 1]);
  });

  test("empty task list returns empty buckets", () => {
    const b = fallbackCategorize("gtd", []);
    expect(Object.keys(b).length).toBe(0);
  });
});

// -- resolveDate --

describe("resolveDate", () => {
  test("'today' returns current ISO date", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(resolveDate("today")).toBe(today);
  });

  test("'tomorrow' returns next day", () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    expect(resolveDate("tomorrow")).toBe(tomorrow);
  });

  test("day names return future dates", () => {
    const result = resolveDate("monday");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const d = new Date(result + "T00:00:00");
    expect(d.getDay()).toBe(1); // Monday
    expect(new Date(result).getTime()).toBeGreaterThan(Date.now() - 86400000);
  });

  test("ISO passthrough", () => {
    expect(resolveDate("2026-07-15")).toBe("2026-07-15");
  });

  test("invalid input returned as-is", () => {
    expect(resolveDate("next month")).toBe("next month");
  });

  test("case insensitive", () => {
    const result = resolveDate("TODAY");
    const today = new Date().toISOString().slice(0, 10);
    expect(result).toBe(today);
  });
});

// -- getVisibleTasks --

describe("getVisibleTasks", () => {
  const tasks = [
    makeTask({ id: "1", content: "Buy milk", status: "open", project: "home", dueDate: "2026-07-01", tags: ["errands"] }),
    makeTask({ id: "2", content: "Write report", status: "done", project: "work", dueDate: "2026-06-01" }),
    makeTask({ id: "3", content: "Fix faucet", status: "open", project: "home", dueDate: null }),
    makeTask({ id: "4", content: "Read book", status: "in_progress", project: "personal", dueDate: "2026-12-01" }),
  ];

  test("today/projects view returns all tasks", () => {
    const result = getVisibleTasks(tasks, "today", {}, false, "", "", "default");
    expect(result.length).toBe(4);
  });

  test("hideDone filters out done tasks", () => {
    const result = getVisibleTasks(tasks, "today", {}, true, "", "", "default");
    expect(result.length).toBe(3);
    expect(result.every(t => t.status !== "done")).toBe(true);
  });

  test("searchFilter matches content", () => {
    const result = getVisibleTasks(tasks, "today", {}, false, "", "milk", "default");
    expect(result.length).toBe(1);
    expect(result[0]!.content).toBe("Buy milk");
  });

  test("searchFilter matches tags", () => {
    const result = getVisibleTasks(tasks, "today", {}, false, "", "errands", "default");
    expect(result.length).toBe(1);
    expect(result[0]!.content).toBe("Buy milk");
  });

  test("projectFilter matches project name", () => {
    const result = getVisibleTasks(tasks, "today", {}, false, "home", "", "default");
    expect(result.length).toBe(2);
    expect(result.every(t => t.project === "home")).toBe(true);
  });

  test("sort by due puts undated last", () => {
    const result = getVisibleTasks(tasks, "today", {}, false, "", "", "due");
    expect(result[0]!.dueDate).toBe("2026-06-01");
    expect(result[result.length - 1]!.dueDate).toBeNull();
  });

  test("sort by status groups done together", () => {
    const result = getVisibleTasks(tasks, "today", {}, false, "", "", "status");
    const statuses = result.map(t => t.status);
    const doneIdx = statuses.indexOf("done");
    const lastDoneIdx = statuses.lastIndexOf("done");
    expect(doneIdx).toBe(lastDoneIdx); // only 1 done
    expect(doneIdx).toBeLessThan(statuses.indexOf("open")); // done < open alphabetically
  });

  test("sort by project groups by project name", () => {
    const result = getVisibleTasks(tasks, "today", {}, false, "", "", "project");
    const projects = result.map(t => t.project);
    const sorted = [...projects].sort();
    expect(projects).toEqual(sorted);
  });

  test("combined: hideDone + searchFilter", () => {
    const result = getVisibleTasks(tasks, "today", {}, true, "", "book", "default");
    expect(result.length).toBe(1);
    expect(result[0]!.content).toBe("Read book");
  });

  test("bucket-based view uses bucket indices", () => {
    const buckets = { todo: [0, 2], done: [1] };
    const result = getVisibleTasks(tasks, "kanban", buckets, false, "", "", "default");
    expect(result.length).toBe(3);
  });

  test("empty tasks returns empty", () => {
    const result = getVisibleTasks([], "today", {}, false, "", "", "default");
    expect(result.length).toBe(0);
  });
});

// -- hashTasks --

describe("hashTasks", () => {
  test("same tasks produce same hash", () => {
    const tasks = [makeTask({ id: "a", content: "hello" })];
    const h1 = hashTasks(tasks);
    const h2 = hashTasks(tasks);
    expect(h1).toBe(h2);
  });

  test("different content produces different hash", () => {
    const t1 = [makeTask({ id: "a", content: "hello" })];
    const t2 = [makeTask({ id: "a", content: "world" })];
    expect(hashTasks(t1)).not.toBe(hashTasks(t2));
  });

  test("different status produces different hash", () => {
    const t1 = [makeTask({ id: "a", status: "open" })];
    const t2 = [makeTask({ id: "a", status: "done" })];
    expect(hashTasks(t1)).not.toBe(hashTasks(t2));
  });

  test("empty array produces consistent hash", () => {
    expect(hashTasks([])).toBe(hashTasks([]));
  });
});

// -- taskSearchText --

describe("taskSearchText", () => {
  test("includes content, project, tags, dates", () => {
    const task = makeTask({
      content: "Buy milk",
      project: "home",
      tags: ["errands", "urgent"],
      dueDate: "2026-07-01",
    });
    const text = taskSearchText(task);
    expect(text).toContain("buy milk");
    expect(text).toContain("home");
    expect(text).toContain("@errands");
    expect(text).toContain("@urgent");
    expect(text).toContain("2026-07-01");
  });

  test("handles null dates", () => {
    const task = makeTask({ dueDate: null, doneDate: null });
    const text = taskSearchText(task);
    expect(typeof text).toBe("string");
  });
});

// -- filterBucketIndices --

describe("filterBucketIndices", () => {
  test("filters to only visible tasks", () => {
    const tasks = [
      makeTask({ id: "a" }),
      makeTask({ id: "b" }),
      makeTask({ id: "c" }),
    ];
    const visibleIdx = new Map([["a", 0], ["c", 1]]);
    const result = filterBucketIndices([0, 1, 2], tasks, visibleIdx);
    expect(result).toEqual([0, 2]);
  });

  test("sorts by visible index order", () => {
    const tasks = [
      makeTask({ id: "a" }),
      makeTask({ id: "b" }),
      makeTask({ id: "c" }),
    ];
    const visibleIdx = new Map([["c", 0], ["a", 1]]);
    const result = filterBucketIndices([0, 2], tasks, visibleIdx);
    expect(result).toEqual([2, 0]); // c at visible 0, a at visible 1
  });

  test("handles out-of-bounds indices", () => {
    const tasks = [makeTask({ id: "a" })];
    const visibleIdx = new Map([["a", 0]]);
    const result = filterBucketIndices([0, 5, 10], tasks, visibleIdx);
    expect(result).toEqual([0]);
  });

  test("empty indices returns empty", () => {
    const result = filterBucketIndices([], [], new Map());
    expect(result).toEqual([]);
  });
});
