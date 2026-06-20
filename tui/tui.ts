#!/usr/bin/env bun

import React from "react";
import { render } from "ink";
import { loadConfig, saveConfig, type DadTodoConfig } from "./config";
import { App } from "./DadTodoApp";

async function ensurePiAuth(): Promise<boolean> {
  try {
    const { createAgentSession, DefaultResourceLoader, getAgentDir } = await import("@earendil-works/pi-coding-agent");
    const loader = new DefaultResourceLoader({ cwd: process.cwd(), agentDir: getAgentDir() });
    await loader.reload();
    await createAgentSession({ cwd: process.cwd(), resourceLoader: loader });
    return true;
  } catch {
    return false;
  }
}

async function askPiForConfig(dir: string, fileList: string[]): Promise<{ file_types: string[]; parse_mode: DadTodoConfig["parse_mode"] }> {
  const { createAgentSession, DefaultResourceLoader, getAgentDir } = await import("@earendil-works/pi-coding-agent");
  const loader = new DefaultResourceLoader({ cwd: process.cwd(), agentDir: getAgentDir() });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: process.cwd(), resourceLoader: loader });

  let result = "";
  const done = new Promise<void>((resolve) => {
    session.subscribe((e: any) => {
      if (e.type === "message_update" && e.message?.content) {
        result = typeof e.message.content === "string"
          ? e.message.content
          : Array.isArray(e.message.content)
            ? e.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
            : "";
      }
      if (e.type === "agent_end") resolve();
    });
  });

  const prompt = `You're helping set up a terminal todo app called dadtodo. The user's folder "${dir}" contains these files:

${fileList.slice(0, 50).join("\n")}
${fileList.length > 50 ? `\n... and ${fileList.length - 50} more files` : ""}

Based on these files, recommend the best configuration. Return ONLY valid JSON:
{
  "file_types": [".md"],
  "parse_mode": "checkboxes_only",
  "reasoning": "Short explanation of why"
}

Rules:
- file_types: pick from [".md", ".txt", ".todo", ".taskpaper", ".tasks", ".list"] - only include types that exist in the folder
- parse_mode: "checkboxes_only" if the files use checkbox syntax (- [ ]), "all_lists" if they use bullets/numbered lists as tasks, "everything" only for .todo/.taskpaper files
- Be conservative - fewer file types and stricter parse mode is better than parsing too much noise`;

  await session.prompt(prompt);
  await done;

  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        file_types: parsed.file_types ?? [".md"],
        parse_mode: parsed.parse_mode ?? "checkboxes_only",
      };
    }
  } catch {}
  return { file_types: [".md"], parse_mode: "checkboxes_only" };
}

function scanDir(dir: string): string[] {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const { join, relative } = require("node:path") as typeof import("node:path");
  const results: string[] = [];
  function walk(d: string) {
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const full = join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else results.push(relative(dir, full));
      }
    } catch {}
  }
  walk(dir);
  return results;
}

async function runWizard(): Promise<DadTodoConfig> {
  const { createInterface } = await import("node:readline");
  const { readdirSync, statSync } = await import("node:fs");
  const { resolve: resolvePath, dirname, basename, extname } = await import("node:path");

  const pathCompleter = (line: string): [string[], string] => {
    try {
      let input = line.trim();
      if (input.startsWith("~")) input = input.replace("~", process.env.HOME ?? ".");
      if (!input) input = ".";
      const isDir = input.endsWith("/");
      const dir = isDir ? input : dirname(input);
      const prefix = isDir ? "" : basename(input);
      const entries = readdirSync(resolvePath(dir))
        .filter(e => e.startsWith(prefix) && !e.startsWith("."))
        .filter(e => { try { return statSync(resolvePath(dir, e)).isDirectory(); } catch { return false; } })
        .map(e => (dir === "." ? e : dir + (dir.endsWith("/") ? "" : "/") + e) + "/");
      return [entries, line];
    } catch { return [[], line]; }
  };

  const rl = createInterface({ input: process.stdin, output: process.stdout, completer: pathCompleter });
  const ask = (q: string): Promise<string> =>
    new Promise(resolve => rl.question(q, resolve));

  console.log("\n  Welcome to DadTodo!\n");

  // Step 1: Require Pi auth
  console.log("  DadTodo uses Pi agent for AI-powered views.");
  console.log("  Checking authentication...\n");
  const hasAuth = await ensurePiAuth();
  if (!hasAuth) {
    console.log("  Pi agent is not authenticated.");
    console.log("  Please run:  pi auth");
    console.log("  Then re-run: dadtodo\n");
    rl.close();
    process.exit(1);
  }
  console.log("  Authenticated!\n");

  // Step 2: Ask for folder (needs tab completion, can't delegate to Pi)
  let resolved = "";
  while (!resolved) {
    const dir = (await ask("  Which folder contains your todo files? (Tab to autocomplete)\n  > ")).trim() || process.cwd();
    const candidate = dir.startsWith("~")
      ? dir.replace("~", process.env.HOME ?? ".")
      : dir.startsWith("/")
        ? dir
        : `${process.cwd()}/${dir}`;
    try {
      if (statSync(candidate).isDirectory()) resolved = candidate;
      else console.log("  Not a directory. Try again.\n");
    } catch {
      console.log("  Directory does not exist. Try again.\n");
    }
  }

  // Step 3: Let Pi analyze the folder and recommend config
  console.log("\n  Scanning your files and asking Pi for the best config...\n");
  const files = scanDir(resolved);
  const exts = [...new Set(files.map(f => extname(f).toLowerCase()).filter(Boolean))];
  console.log(`  Found ${files.length} files (${exts.join(", ") || "no extensions"})\n`);

  const piConfig = await askPiForConfig(resolved, files);

  console.log(`  Pi recommends:`);
  console.log(`    File types: ${piConfig.file_types.join(", ")}`);
  console.log(`    Parse mode: ${piConfig.parse_mode}\n`);
  const confirm = (await ask("  Use this config? (Y/n) > ")).trim().toLowerCase();

  let fileTypes = piConfig.file_types;
  let parseMode = piConfig.parse_mode;

  if (confirm === "n" || confirm === "no") {
    console.log("\n  What file types should I look for?");
    console.log("  1) Markdown only (.md)");
    console.log("  2) Markdown + text (.md, .txt)");
    console.log("  3) All task files (.md, .txt, .todo, .taskpaper, .tasks, .list)");
    const ftChoice = (await ask("  > ")).trim();
    fileTypes =
      ftChoice === "1" ? [".md"] :
      ftChoice === "2" ? [".md", ".txt"] :
      [".md", ".txt", ".todo", ".taskpaper", ".tasks", ".list"];

    console.log("\n  How should I parse list items?");
    console.log("  1) Checkboxes only (- [ ] / - [x])");
    console.log("  2) All list items (bullets, numbered, checkboxes)");
    console.log("  3) Everything (all list items in all files)");
    const pmChoice = (await ask("  > ")).trim();
    parseMode =
      pmChoice === "1" ? "checkboxes_only" :
      pmChoice === "2" ? "all_lists" :
      "everything";
  }

  rl.close();

  const config: DadTodoConfig = {
    watched_dir: resolved,
    file_types: fileTypes,
    parse_mode: parseMode,
    ai_configured: true,
  };

  saveConfig(config);
  console.log("\n  Config saved to ~/.dadtodo/config.json\n");
  return config;
}

function createDemoDir(): string {
  const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const dir = join(tmpdir(), "dadtodo-demo");
  mkdirSync(dir, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  writeFileSync(join(dir, "work.md"), `# Work
- [ ] Review quarterly report <!-- due:${today} -->
- [/] Update API documentation
- [ ] Prepare team standup notes <!-- due:${tomorrow} -->
- [x] Fix login page bug <!-- done:${yesterday} -->
- [ ] Deploy v2.1 to staging <!-- due:${nextWeek} -->
- [ ] Write tests for payment flow

## Backlog
- [ ] Refactor auth middleware
- [ ] Add dark mode support
`);

  writeFileSync(join(dir, "personal.md"), `# Personal
- [ ] Buy groceries <!-- due:${today} --> <!-- tags:errands -->
- [ ] Call dentist for appointment <!-- due:${yesterday} -->
- [x] Pay electricity bill <!-- done:${today} -->
- [ ] Plan weekend trip <!-- due:${nextWeek} --> <!-- tags:travel -->
- [ ] Read "Atomic Habits" chapter 5

## Someday
- [ ] Learn to play guitar
- [ ] Organize garage
`);

  writeFileSync(join(dir, "health.md"), `# Health
- [ ] Morning run - 5k <!-- due:${tomorrow} --> <!-- tags:fitness -->
- [/] Track water intake this week
- [x] Book annual checkup <!-- done:${yesterday} -->
- [ ] Meal prep for the week <!-- due:${today} -->
`);

  return dir;
}

async function main() {
  // CLI args
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("dadtodo - terminal todo app that morphs between views\n");
    console.log("Usage: dadtodo [options]\n");
    console.log("  --help, -h     Show this help");
    console.log("  --reset        Re-run setup wizard");
    console.log("  --demo         Try with sample data (no setup needed)");
    console.log("  --dir <path>   Override watched directory");
    console.log("  --version      Show version");
    process.exit(0);
  }

  if (args.includes("--version")) {
    const pkg = require("./package.json");
    console.log(`dadtodo ${pkg.version}`);
    process.exit(0);
  }

  if (args.includes("--demo")) {
    const demoDir = createDemoDir();
    console.log(`  Demo mode: using sample data in ${demoDir}\n`);
    const config: DadTodoConfig = {
      watched_dir: demoDir,
      file_types: [".md"],
      parse_mode: "checkboxes_only",
      ai_configured: false,
    };
    render(React.createElement(App, { config, isDemo: true }));
    return;
  }

  let config = loadConfig();

  if (!config || args.includes("--reset")) {
    config = await runWizard();
  }

  // Override dir from CLI
  const dirIdx = args.indexOf("--dir");
  if (dirIdx !== -1 && args[dirIdx + 1]) {
    config.watched_dir = args[dirIdx + 1]!;
  }

  render(React.createElement(App, { config }));
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
