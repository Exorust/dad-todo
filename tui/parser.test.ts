import { test, expect, describe } from "bun:test";
import { parseAllFiles, type Task } from "./parser";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const TMP = join(import.meta.dir, ".test-tmp");

function setup(files: Record<string, string>) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(TMP, name), content);
  }
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true });
}

describe("parser", () => {
  test("parses checkboxes", async () => {
    setup({ "test.md": "# Tasks\n- [ ] Open task\n- [x] Done task\n- [/] In progress\n" });
    const tasks = await parseAllFiles(TMP);
    expect(tasks.length).toBe(3);
    expect(tasks[0]!.status).toBe("open");
    expect(tasks[0]!.sourceType).toBe("checkbox");
    expect(tasks[1]!.status).toBe("done");
    expect(tasks[2]!.status).toBe("in_progress");
    teardown();
  });

  test("parses bullets", async () => {
    setup({ "test.md": "- Buy milk\n* Feed cat\n+ Walk dog\n" });
    const tasks = await parseAllFiles(TMP);
    expect(tasks.length).toBe(3);
    expect(tasks[0]!.sourceType).toBe("bullet");
    expect(tasks[0]!.content).toBe("Buy milk");
    teardown();
  });

  test("parses numbered lists", async () => {
    setup({ "test.md": "1. First\n2) Second\n" });
    const tasks = await parseAllFiles(TMP);
    expect(tasks.length).toBe(2);
    expect(tasks[0]!.sourceType).toBe("numbered");
    teardown();
  });

  test("extracts inline metadata", async () => {
    setup({ "test.md": "- [ ] Pay rent <!-- due:2026-07-01 --> <!-- tags:bills,urgent -->\n" });
    const tasks = await parseAllFiles(TMP);
    expect(tasks[0]!.dueDate).toBe("2026-07-01");
    expect(tasks[0]!.tags).toContain("bills");
    expect(tasks[0]!.tags).toContain("urgent");
    teardown();
  });

  test("extracts taskpaper-style tags", async () => {
    setup({ "test.todo": "Fix bug @due(2026-07-15) @priority\n" });
    const tasks = await parseAllFiles(TMP);
    expect(tasks[0]!.dueDate).toBe("2026-07-15");
    expect(tasks[0]!.tags).toContain("priority");
    teardown();
  });

  test("tracks headings", async () => {
    setup({ "test.md": "# Work\n- [ ] Task A\n## Sub\n- [ ] Task B\n" });
    const tasks = await parseAllFiles(TMP);
    expect(tasks[0]!.heading).toBe("Work");
    expect(tasks[1]!.heading).toBe("Sub");
    teardown();
  });

  test("skips code fences", async () => {
    setup({ "test.md": "```\n- [ ] Not a task\n```\n- [ ] Real task\n" });
    const tasks = await parseAllFiles(TMP);
    expect(tasks.length).toBe(1);
    expect(tasks[0]!.content).toBe("Real task");
    teardown();
  });

  test("skips separator lines", async () => {
    setup({ "test.md": "---\n- [ ] Task\n***\n" });
    const tasks = await parseAllFiles(TMP);
    expect(tasks.length).toBe(1);
    teardown();
  });

  test("sets project from filename", async () => {
    setup({ "work.md": "- [ ] Do stuff\n" });
    const tasks = await parseAllFiles(TMP);
    expect(tasks[0]!.project).toBe("work");
    teardown();
  });

  test("parses sample-todos correctly", async () => {
    const tasks = await parseAllFiles(join(import.meta.dir, "..", "sample-todos"));
    expect(tasks.length).toBeGreaterThan(40);
    const done = tasks.filter(t => t.status === "done");
    expect(done.length).toBeGreaterThan(0);
    const withDates = tasks.filter(t => t.dueDate);
    expect(withDates.length).toBeGreaterThan(0);
  });

  test("respects checkboxes_only parse mode", async () => {
    setup({ "test.md": "- [ ] Checkbox\n- Bullet\n1. Numbered\n" });
    const tasks = await parseAllFiles(TMP, { parseMode: "checkboxes_only" });
    expect(tasks.length).toBe(1);
    expect(tasks[0]!.content).toBe("Checkbox");
    teardown();
  });

  test("all_lists parse mode excludes plain taskpaper lines", async () => {
    setup({ "test.todo": "Plain task\n- Bullet task\n" });
    const tasks = await parseAllFiles(TMP, { parseMode: "all_lists" });
    expect(tasks.length).toBe(1);
    expect(tasks[0]!.content).toBe("Bullet task");
    teardown();
  });

  test("respects configured file types", async () => {
    setup({
      "test.md": "- [ ] Markdown task\n",
      "test.txt": "- [ ] Text task\n",
    });
    const tasks = await parseAllFiles(TMP, { fileTypes: [".md"] });
    expect(tasks.length).toBe(1);
    expect(tasks[0]!.content).toBe("Markdown task");
    teardown();
  });
});
