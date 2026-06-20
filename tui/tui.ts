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


async function runWizard(): Promise<DadTodoConfig> {
  const { createInterface } = await import("node:readline");
  const { statSync } = await import("node:fs");
  const { resolve: resolvePath } = await import("node:path");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise(resolve => rl.question(q, resolve));

  console.log("\n  Welcome to DadTodo!\n");
  console.log("  Point me at the folder with your todo/markdown files.");
  console.log("  I'll watch it for changes and parse checkboxes as tasks.\n");

  let resolved = "";
  while (!resolved) {
    const dir = (await ask(`  Folder path [${process.cwd()}]: `)).trim() || process.cwd();
    const candidate = dir.startsWith("~")
      ? dir.replace("~", process.env.HOME ?? ".")
      : resolvePath(dir);
    try {
      if (statSync(candidate).isDirectory()) resolved = candidate;
      else console.log("  Not a directory. Try again.\n");
    } catch {
      console.log("  Directory does not exist. Try again.\n");
    }
  }

  rl.close();

  const hasAuth = await ensurePiAuth();

  const config: DadTodoConfig = {
    watched_dir: resolved,
    file_types: [".md"],
    parse_mode: "checkboxes_only",
    ai_configured: hasAuth,
  };

  saveConfig(config);
  console.log(`\n  Watching ${resolved} for .md files with checkboxes.`);
  if (!hasAuth) console.log("  Run 'pi auth' to enable AI-powered views.");
  console.log("  Config saved. Run 'dadtodo --reset' to change.\n");
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
