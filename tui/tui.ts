#!/usr/bin/env bun

import { loadConfig, saveConfig, type DadTodoConfig } from "./config";
import { DadTodoApp } from "./app";

async function runWizard(): Promise<DadTodoConfig> {
  const { createInterface } = await import("node:readline");
  const { readdirSync, statSync } = await import("node:fs");
  const { resolve: resolvePath, dirname, basename } = await import("node:path");

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
  console.log("  Let's set things up.\n");

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

  console.log("\n  What file types should I look for?");
  console.log("  1) Markdown only (.md)");
  console.log("  2) Markdown + text (.md, .txt)");
  console.log("  3) All task files (.md, .txt, .todo, .taskpaper, .tasks, .list)");
  const ftChoice = (await ask("  > ")).trim();
  const fileTypes =
    ftChoice === "1" ? [".md"] :
    ftChoice === "2" ? [".md", ".txt"] :
    [".md", ".txt", ".todo", ".taskpaper", ".tasks", ".list"];

  console.log("\n  How should I parse list items?");
  console.log("  1) Checkboxes only (- [ ] / - [x])");
  console.log("  2) All list items (bullets, numbered, checkboxes)");
  console.log("  3) Everything (all list items in all files)");
  const pmChoice = (await ask("  > ")).trim();
  const parseMode: DadTodoConfig["parse_mode"] =
    pmChoice === "1" ? "checkboxes_only" :
    pmChoice === "2" ? "all_lists" :
    "everything";

  rl.close();

  const config: DadTodoConfig = {
    watched_dir: resolved,
    file_types: fileTypes,
    parse_mode: parseMode,
    ai_configured: false,
  };

  saveConfig(config);
  console.log("\n  Config saved to ~/.dadtodo/config.json\n");
  return config;
}

async function main() {
  // CLI args
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("dadtodo - terminal todo app that morphs between views\n");
    console.log("Usage: dadtodo [options]\n");
    console.log("  --help, -h     Show this help");
    console.log("  --reset        Re-run setup wizard");
    console.log("  --dir <path>   Override watched directory");
    process.exit(0);
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

  const app = new DadTodoApp(config);
  await app.start();
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
