#!/usr/bin/env node

import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  execSync("which bun", { stdio: "ignore" });
} catch {
  console.error("dadtodo requires the Bun runtime.\n");
  console.error("Install it with:");
  console.error("  curl -fsSL https://bun.sh/install | bash\n");
  console.error("Then run: dadtodo");
  process.exit(1);
}

try {
  execFileSync("bun", [join(__dirname, "..", "tui.ts"), ...process.argv.slice(2)], {
    stdio: "inherit",
  });
} catch (err) {
  process.exit(err.status ?? 1);
}
