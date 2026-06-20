import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, extname, basename } from "node:path";

export interface Task {
  id: string;
  content: string;
  status: "open" | "in_progress" | "done";
  filePath: string;
  lineNumber: number;
  project: string;
  heading: string;
  dueDate: string | null;
  doneDate: string | null;
  tags: string[];
  raw: string;
  sourceType: "checkbox" | "bullet" | "numbered" | "plain";
}

export type ParseMode = "checkboxes_only" | "all_lists" | "everything";

export interface ParseOptions {
  fileTypes?: string[];
  parseMode?: ParseMode;
}

// -- Patterns --

// Checkbox: - [ ] task, - [x] task, - [/] task, * [x] task
const CHECKBOX_RE = /^(\s*)[-*+]\s*\[([ x/X])\]\s+(.*)/;
// Bullet list: - task, * task, + task (but not --- or *** separators)
const BULLET_RE = /^(\s*)[-*+]\s+(.+)/;
// Numbered list: 1. task, 2) task
const NUMBERED_RE = /^(\s*)\d+[.)]\s+(.*)/;
// Headings: # Heading, ## Heading
const HEADING_RE = /^(#{1,6})\s+(.*)/;
// Separator lines (not tasks)
const SEPARATOR_RE = /^(\s*)([-*_])\2{2,}\s*$/;
// Inline metadata
const DUE_RE = /<!--\s*due:(\d{4}-\d{2}-\d{2})\s*-->/;
const DONE_RE = /<!--\s*done:(\d{4}-\d{2}-\d{2})\s*-->/;
const TAGS_RE = /<!--\s*tags:([\w,]+)\s*-->/;
// Taskpaper-style tags: @due(2026-06-25) @done @tag(value)
const TP_DUE_RE = /@due\((\d{4}-\d{2}-\d{2})\)/;
const TP_DONE_RE = /@done(?:\((\d{4}-\d{2}-\d{2})\))?/;
const TP_TAG_RE = /@(\w+)(?:\([^)]*\))?/g;
// Natural language date hints
const NATURAL_DATE_WORDS = /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|this week|next week|this weekend)\b/i;
// Lines to skip
const SKIP_RE = /^(\s*$|```|>|!\[|<|---|\*\*\*|___)/;
// Code fence tracking
const FENCE_RE = /^(\s*)```/;

const TEXT_EXTENSIONS = new Set([
  ".md", ".txt", ".todo", ".taskpaper", ".tasks", ".list",
  ".org", ".rst", ".markdown", ".mdown",
]);

export function isTextFile(name: string): boolean {
  if (TEXT_EXTENSIONS.has(extname(name).toLowerCase())) return true;
  // Files with no extension that aren't hidden (e.g. "TODO", "TASKS")
  if (!extname(name) && !name.startsWith(".")) {
    const upper = name.toUpperCase();
    return ["TODO", "TODOS", "TASKS", "NOTES", "CHECKLIST", "LIST"].includes(upper);
  }
  return false;
}

function statusFromMarker(marker: string): Task["status"] {
  if (marker.toLowerCase() === "x") return "done";
  if (marker === "/") return "in_progress";
  return "open";
}

function extractMetadata(text: string): {
  clean: string;
  dueDate: string | null;
  doneDate: string | null;
  tags: string[];
  inferredStatus: Task["status"] | null;
} {
  let clean = text;
  let dueDate: string | null = null;
  let doneDate: string | null = null;
  const tags: string[] = [];
  let inferredStatus: Task["status"] | null = null;

  // HTML comment metadata
  const dueMatch = clean.match(DUE_RE);
  if (dueMatch) { dueDate = dueMatch[1]!; clean = clean.replace(DUE_RE, ""); }
  const doneMatch = clean.match(DONE_RE);
  if (doneMatch) { doneDate = doneMatch[1]!; clean = clean.replace(DONE_RE, ""); }
  const tagsMatch = clean.match(TAGS_RE);
  if (tagsMatch) { tags.push(...tagsMatch[1]!.split(",")); clean = clean.replace(TAGS_RE, ""); }

  // Taskpaper-style @tags
  const tpDue = clean.match(TP_DUE_RE);
  if (tpDue) { dueDate = dueDate ?? tpDue[1]!; clean = clean.replace(TP_DUE_RE, ""); }
  const tpDone = clean.match(TP_DONE_RE);
  if (tpDone) {
    doneDate = doneDate ?? tpDone[1] ?? new Date().toISOString().slice(0, 10);
    inferredStatus = "done";
    clean = clean.replace(TP_DONE_RE, "");
  }
  let tpTag;
  const tpClone = clean;
  const tpTagRe = /@(\w+)(?:\([^)]*\))?/g;
  while ((tpTag = tpTagRe.exec(tpClone)) !== null) {
    const tag = tpTag[1]!;
    if (!["due", "done"].includes(tag) && !tags.includes(tag)) tags.push(tag);
  }
  // Remove all @tags from display
  clean = clean.replace(/@\w+(?:\([^)]*\))?/g, "");

  return { clean: clean.trim(), dueDate, doneDate, tags, inferredStatus };
}

function parseFile(content: string, filePath: string, baseDir: string, parseMode: ParseMode): Task[] {
  const lines = content.split("\n");
  const tasks: Task[] = [];
  let currentHeading = "";
  const ext = extname(filePath).toLowerCase();
  const proj = relative(baseDir, filePath)
    .replace(/\.[^/.]+$/, "")
    .replace(/\//g, " / ");

  let inCodeFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Track code fences - skip everything inside
    if (FENCE_RE.test(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    // Headings
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      currentHeading = headingMatch[2]!.trim();
      continue;
    }

    // Skip separators, blank lines, blockquotes, images, HTML
    if (SKIP_RE.test(line)) continue;
    // Skip lines that are just a URL
    if (/^\s*https?:\/\/\S+\s*$/.test(line)) continue;

    // -- Priority 1: Checkbox items (strongest signal) --
    const cbMatch = line.match(CHECKBOX_RE);
    if (cbMatch) {
      const status = statusFromMarker(cbMatch[2]!);
      const meta = extractMetadata(cbMatch[3]!);
      if (meta.clean.length < 2) continue; // skip empty checkboxes
      tasks.push({
        id: `${filePath}:${i + 1}`,
        content: meta.clean,
        status: meta.inferredStatus ?? status,
        filePath,
        lineNumber: i + 1,
        project: proj,
        heading: currentHeading,
        dueDate: meta.dueDate,
        doneDate: status === "done" && !meta.doneDate
          ? new Date().toISOString().slice(0, 10)
          : meta.doneDate,
        tags: meta.tags,
        raw: line,
        sourceType: "checkbox",
      });
      continue;
    }

    if (parseMode === "checkboxes_only") continue;

    // Skip separator-like bullet lines
    if (SEPARATOR_RE.test(line)) continue;

    // -- Priority 2: Bullet list items --
    const bulletMatch = line.match(BULLET_RE);
    if (bulletMatch) {
      const text = bulletMatch[2]!;
      // Skip if it looks like a link definition or image
      if (/^\[.*\]:/.test(text)) continue;
      // Skip very long lines (likely prose, not a task)
      if (text.length > 200) continue;
      const meta = extractMetadata(text);
      if (meta.clean.length < 2) continue;
      tasks.push({
        id: `${filePath}:${i + 1}`,
        content: meta.clean,
        status: meta.inferredStatus ?? "open",
        filePath,
        lineNumber: i + 1,
        project: proj,
        heading: currentHeading,
        dueDate: meta.dueDate,
        doneDate: meta.doneDate,
        tags: meta.tags,
        raw: line,
        sourceType: "bullet",
      });
      continue;
    }

    // -- Priority 3: Numbered list items --
    const numMatch = line.match(NUMBERED_RE);
    if (numMatch) {
      const text = numMatch[2]!;
      if (text.length > 200) continue;
      const meta = extractMetadata(text);
      if (meta.clean.length < 2) continue;
      tasks.push({
        id: `${filePath}:${i + 1}`,
        content: meta.clean,
        status: meta.inferredStatus ?? "open",
        filePath,
        lineNumber: i + 1,
        project: proj,
        heading: currentHeading,
        dueDate: meta.dueDate,
        doneDate: meta.doneDate,
        tags: meta.tags,
        raw: line,
        sourceType: "numbered",
      });
      continue;
    }

    if (parseMode !== "everything") continue;

    // -- Priority 4: Plain text lines in .todo/.taskpaper/.tasks/.list files --
    // These file types are task-focused, so every non-blank line is a task
    if ([".todo", ".taskpaper", ".tasks", ".list"].includes(ext)) {
      const trimmed = line.trim();
      if (trimmed.length < 2) continue;
      // Taskpaper projects/sections end with ":"
      if (trimmed.endsWith(":")) {
        currentHeading = trimmed.slice(0, -1);
        continue;
      }
      const meta = extractMetadata(trimmed);
      if (meta.clean.length < 2) continue;
      tasks.push({
        id: `${filePath}:${i + 1}`,
        content: meta.clean,
        status: meta.inferredStatus ?? "open",
        filePath,
        lineNumber: i + 1,
        project: proj,
        heading: currentHeading,
        dueDate: meta.dueDate,
        doneDate: meta.doneDate,
        tags: meta.tags,
        raw: line,
        sourceType: "plain",
      });
    }

    // For .md/.txt: only parse structured list items, not prose paragraphs
  }

  return tasks;
}

async function findFiles(dir: string, fileTypes?: string[]): Promise<string[]> {
  const results: string[] = [];
  const allowedExts = fileTypes ? new Set(fileTypes.map(e => e.toLowerCase())) : null;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findFiles(full, fileTypes)));
    } else if (isTextFile(entry.name)) {
      const ext = extname(entry.name).toLowerCase();
      if (allowedExts && ext && !allowedExts.has(ext)) continue;
      // Skip files larger than 1MB (probably not todo files)
      try {
        const s = await stat(full);
        if (s.size < 1_000_000) results.push(full);
      } catch { /* skip unreadable */ }
    }
  }
  return results;
}

export function matchesConfiguredFile(filePath: string, fileTypes?: string[]): boolean {
  if (!isTextFile(filePath)) return false;
  if (!fileTypes) return true;
  const ext = extname(filePath).toLowerCase();
  return !ext || fileTypes.map(e => e.toLowerCase()).includes(ext);
}

export async function parseOneFile(filePath: string, baseDir: string, options: ParseOptions = {}): Promise<Task[]> {
  if (!matchesConfiguredFile(filePath, options.fileTypes)) return [];
  try {
    const s = await stat(filePath);
    if (!s.isFile() || s.size >= 1_000_000) return [];
    const content = await readFile(filePath, "utf-8");
    return parseFile(content, filePath, baseDir, options.parseMode ?? "everything");
  } catch {
    return [];
  }
}

export async function parseAllFiles(dir: string, options: ParseOptions = {}): Promise<Task[]> {
  const parseMode = options.parseMode ?? "everything";
  const files = await findFiles(dir, options.fileTypes);
  const tasks: Task[] = [];
  for (const file of files) {
    tasks.push(...(await parseOneFile(file, dir, { ...options, parseMode })));
  }
  return tasks;
}
