import { watch, type FSWatcher } from "node:fs";
import { extname, join } from "node:path";
import { isTextFile } from "./parser";

export function startWatcher(
  dir: string,
  fileTypes: string[],
  onChange: (filePath: string) => void
): FSWatcher {
  const exts = new Set(fileTypes);
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  const watcher = watch(dir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const name = filename.toString();
    const ext = extname(name).toLowerCase();
    if (ext ? !exts.has(ext) : !isTextFile(name)) return;
    if (name.includes("node_modules") || name.startsWith(".")) return;

    const filePath = join(dir, name);
    const existing = pending.get(filePath);
    if (existing) clearTimeout(existing);
    pending.set(filePath, setTimeout(() => {
      pending.delete(filePath);
      onChange(filePath);
    }, 200));
  });

  return watcher;
}
