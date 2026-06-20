import { parseAllFiles } from "./parser";
import { categorizeTasks, generateCustomView, studioChat } from "./categorizer";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { createHash } from "node:crypto";

// -- Disk cache for categorizations --
const CACHE_DIR = join(process.env.HOME ?? ".", ".dadtodo", "cache");
try { mkdirSync(CACHE_DIR, { recursive: true }); } catch {}

interface CacheEntry {
  hash: string;
  buckets: Record<string, number[]>;
  timestamp: number;
}

function hashTasks(tasks: any[], viewName: string): string {
  const key = tasks.map((t: any) => `${t.id}:${t.status}:${t.content}`).join("|");
  return createHash("md5").update(`${viewName}:${key}`).digest("hex");
}

function readCache(viewName: string): CacheEntry | null {
  try {
    const data = readFileSync(join(CACHE_DIR, `${viewName}.json`), "utf-8");
    return JSON.parse(data);
  } catch { return null; }
}

function writeCache(viewName: string, hash: string, buckets: Record<string, number[]>) {
  try {
    writeFileSync(
      join(CACHE_DIR, `${viewName}.json`),
      JSON.stringify({ hash, buckets, timestamp: Date.now() })
    );
  } catch {}
}

function respond(reqId: unknown, data: Record<string, unknown>) {
  process.stdout.write(JSON.stringify({ type: "response", reqId, ...data }) + "\n");
}

function checkSetup(): { configured: boolean; agentDir: string; authPath: string; hasAuth: boolean; models: string[] } {
  const agentDir = getAgentDir();
  const authPath = join(agentDir, "auth.json");
  const hasAuth = existsSync(authPath);
  let models: string[] = [];
  if (hasAuth) {
    try {
      const auth = JSON.parse(require("node:fs").readFileSync(authPath, "utf-8"));
      models = Object.keys(auth);
    } catch { /* ignore */ }
  }
  return {
    configured: hasAuth && models.length > 0,
    agentDir,
    authPath,
    hasAuth,
    models,
  };
}

function ruleBasedCategorize(viewName: string, tasks: any[]): Record<string, number[]> {
  const buckets: Record<string, number[]> = {};
  const push = (key: string, i: number) => {
    (buckets[key] ??= []).push(i);
  };

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
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
      default:
        push("all", i);
    }
  }
  return buckets;
}

async function handleMessage(msg: Record<string, any>) {
  const reply = (data: Record<string, unknown>) => respond(msg.reqId, data);
  try {
    switch (msg.type) {
      case "check-setup": {
        reply({ ok: true, ...checkSetup() });
        break;
      }

      case "parse-files": {
        const tasks = await parseAllFiles(msg.dir);
        reply({ ok: true, tasks });
        break;
      }

      case "categorize": {
        const tasks = msg.tasks;
        const viewName = msg.viewName;
        const hash = hashTasks(tasks, viewName);
        const cached = readCache(viewName);

        if (cached && cached.hash === hash) {
          reply({ ok: true, buckets: cached.buckets, source: "cache" });
          break;
        }

        // Return stale cache immediately, then try AI
        if (cached) {
          reply({ ok: true, buckets: cached.buckets, source: "stale", refreshing: true });
        }

        try {
          const buckets = await categorizeTasks(viewName, tasks, msg.customPrompt);
          writeCache(viewName, hash, buckets);
          if (cached) {
            // Was already replied with stale - emit update event
            process.stdout.write(JSON.stringify({
              type: "tasks-updated",
              viewName,
              buckets,
              source: "ai",
            }) + "\n");
          } else {
            reply({ ok: true, buckets, source: "ai" });
          }
        } catch (err: any) {
          if (!cached) {
            // No cache, AI failed - use rule-based fallback
            const fallback = ruleBasedCategorize(viewName, tasks);
            reply({ ok: true, buckets: fallback, source: "fallback" });
          }
        }
        break;
      }

      case "studio-chat": {
        const updatedConfig = await studioChat(
          msg.message,
          msg.viewName,
          msg.viewConfig
        );
        reply({ ok: true, configDelta: updatedConfig });
        break;
      }

      case "update-task": {
        const { filePath, lineNumber, newContent } = msg;
        const content = await readFile(filePath, "utf-8");
        const lines = content.split("\n");
        if (lineNumber >= 1 && lineNumber <= lines.length) {
          lines[lineNumber - 1] = newContent;
          await writeFile(filePath, lines.join("\n"), "utf-8");
          reply({ ok: true });
        } else {
          reply({ ok: false, error: "Line number out of range" });
        }
        break;
      }

      case "create-task": {
        const { filePath, content: taskContent } = msg;
        const existing = await readFile(filePath, "utf-8").catch(() => "");
        const newLine = existing.endsWith("\n") || existing === "" ? "" : "\n";
        await writeFile(filePath, existing + newLine + `- [ ] ${taskContent}\n`, "utf-8");
        reply({ ok: true });
        break;
      }

      case "create-custom-view": {
        const viewDef = await generateCustomView(msg.description);
        reply({ ok: true, view: viewDef });
        break;
      }

      default:
        reply({ ok: false, error: `Unknown message type: ${msg.type}` });
    }
  } catch (err: any) {
    reply({ ok: false, error: err.message || String(err) });
  }
}

let buffer = "";
process.stdin.on("data", (chunk: Buffer) => {
  buffer += new TextDecoder().decode(chunk, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      handleMessage(JSON.parse(line));
    } catch (err) {
      process.stderr.write(`[sidecar] parse error: ${line}\n`);
    }
  }
});

process.stderr.write("[sidecar] DadTodo sidecar ready\n");
