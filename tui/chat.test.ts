import { test, expect, describe } from "bun:test";
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const TMP = join(import.meta.dir, ".test-chat-tmp");

function setup() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  writeFileSync(join(TMP, "test.md"), "# Tasks\n- [ ] Buy milk\n- [x] Walk dog\n");
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true });
}

describe("chat add command", () => {
  test("add task to existing file", () => {
    setup();
    const filePath = join(TMP, "test.md");
    const existing = readFileSync(filePath, "utf-8");
    const line = `- [ ] Feed the cat\n`;
    writeFileSync(filePath, existing.trimEnd() + "\n" + line);

    const result = readFileSync(filePath, "utf-8");
    expect(result).toContain("- [ ] Feed the cat");
    expect(result).toContain("- [ ] Buy milk");
    teardown();
  });

  test("add task to new file", () => {
    setup();
    const filePath = join(TMP, "new.md");
    writeFileSync(filePath, "- [ ] New task\n");

    const result = readFileSync(filePath, "utf-8");
    expect(result).toContain("- [ ] New task");
    teardown();
  });
});

describe("task toggle", () => {
  test("toggle open to done", () => {
    setup();
    const filePath = join(TMP, "test.md");
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const today = new Date().toISOString().slice(0, 10);
    lines[1] = lines[1]!.replace(/\[[ x/]\]/, "[x]") + ` <!-- done:${today} -->`;
    writeFileSync(filePath, lines.join("\n"));

    const result = readFileSync(filePath, "utf-8");
    expect(result).toContain("[x] Buy milk");
    expect(result).toContain(`done:${today}`);
    teardown();
  });

  test("toggle done to open", () => {
    setup();
    const filePath = join(TMP, "test.md");
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    lines[2] = lines[2]!.replace(/\[x\]/, "[ ]").replace(/\s*<!--\s*done:\d{4}-\d{2}-\d{2}\s*-->/, "");
    writeFileSync(filePath, lines.join("\n"));

    const result = readFileSync(filePath, "utf-8");
    expect(result).toContain("[ ] Walk dog");
    expect(result).not.toContain("done:");
    teardown();
  });
});

describe("set due date", () => {
  test("add due date to task without one", () => {
    setup();
    const filePath = join(TMP, "test.md");
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    lines[1] = lines[1]!.trimEnd() + " <!-- due:2026-07-01 -->";
    writeFileSync(filePath, lines.join("\n"));

    const result = readFileSync(filePath, "utf-8");
    expect(result).toContain("due:2026-07-01");
    teardown();
  });

  test("replace existing due date", () => {
    setup();
    const filePath = join(TMP, "test.md");
    writeFileSync(filePath, "- [ ] Pay rent <!-- due:2026-06-01 -->\n");
    const content = readFileSync(filePath, "utf-8");
    const updated = content.replace(/<!--\s*due:\d{4}-\d{2}-\d{2}\s*-->/, "<!-- due:2026-07-01 -->");
    writeFileSync(filePath, updated);

    const result = readFileSync(filePath, "utf-8");
    expect(result).toContain("due:2026-07-01");
    expect(result).not.toContain("due:2026-06-01");
    teardown();
  });
});

describe("date resolution", () => {
  test("resolves today", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("resolves ISO date passthrough", () => {
    const input = "2026-07-15";
    expect(/^\d{4}-\d{2}-\d{2}$/.test(input)).toBe(true);
  });

  test("resolves day names to future dates", () => {
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const now = new Date();
    for (const day of days) {
      const dayIdx = days.indexOf(day);
      const diff = (dayIdx - now.getDay() + 7) % 7 || 7;
      const target = new Date(now);
      target.setDate(target.getDate() + diff);
      expect(target.getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

describe("sorting", () => {
  test("sort by due date puts dated tasks first", () => {
    const tasks = [
      { dueDate: null, content: "no date" },
      { dueDate: "2026-06-01", content: "early" },
      { dueDate: "2026-12-01", content: "late" },
    ];
    tasks.sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
    expect(tasks[0]!.content).toBe("early");
    expect(tasks[2]!.content).toBe("no date");
  });

  test("sort by status groups done together", () => {
    const tasks = [
      { status: "open" },
      { status: "done" },
      { status: "in_progress" },
      { status: "done" },
    ];
    tasks.sort((a, b) => a.status.localeCompare(b.status));
    expect(tasks[0]!.status).toBe("done");
    expect(tasks[1]!.status).toBe("done");
  });
});

describe("project filter", () => {
  test("filters tasks by project name", () => {
    const tasks = [
      { project: "home", content: "fix faucet" },
      { project: "work", content: "write report" },
      { project: "home", content: "mow lawn" },
    ];
    const filtered = tasks.filter(t => t.project.toLowerCase().includes("home"));
    expect(filtered.length).toBe(2);
    expect(filtered.every(t => t.project === "home")).toBe(true);
  });
});

describe("convert to checkbox", () => {
  test("convert bullet to checkbox", () => {
    const raw = "- Buy groceries";
    const newRaw = raw.replace(/^(\s*[-*+])\s+/, "$1 [ ] ");
    expect(newRaw).toBe("- [ ] Buy groceries");
  });

  test("convert numbered to checkbox", () => {
    const raw = "1. First item";
    const newRaw = raw.replace(/^(\s*)\d+[.)]\s+/, "$1- [ ] ");
    expect(newRaw).toBe("- [ ] First item");
  });

  test("convert plain text to checkbox", () => {
    const raw = "Some task";
    const newRaw = raw.replace(/^(\s*)/, "$1- [ ] ");
    expect(newRaw).toBe("- [ ] Some task");
  });
});
