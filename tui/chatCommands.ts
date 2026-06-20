import { readFileSync } from "node:fs";
import { join, basename } from "node:path";
import type { Task } from "./parser";
import type { Buckets, studioChat as StudioChatFn } from "./categorizer";
import { resolveDate } from "./taskHelpers";
import { VIEWS, type ActiveViewName, type SortBy, type ThemeName, type CustomView } from "./types";

export interface ChatContext {
  tasks: Task[];
  visibleTasks: Task[];
  customViews: CustomView[];
  selectedIds: Set<string>;
  watchedDir: string;
  activeView: string;
  aiTimeoutMs?: number;

  reply: (text: string) => void;
  switchView: (view: ActiveViewName) => void;
  setHideDone: (v: boolean) => void;
  setSortBy: (v: SortBy) => void;
  setProjectFilter: (v: string) => void;
  setSearchFilter: (v: string) => void;
  setTheme: (v: ThemeName) => void;
  updateLine: (filePath: string, lineNumber: number, newContent: string, description?: string) => boolean;
  writeFileWithUndo: (filePath: string, before: string, after: string, description: string) => boolean;
  editTaskContent: (task: Task, newText: string) => void;
  createCustomView: (desc: string) => Promise<void>;
  aiChat: (message: string) => Promise<void>;
}

export async function handleChatMessage(message: string, ctx: ChatContext): Promise<void> {
  const lower = message.toLowerCase().trim();

  // -- View switch --
  for (const v of VIEWS) {
    if (lower === v.key || lower === v.label.toLowerCase() || lower.startsWith(`switch to ${v.key}`) || lower.startsWith(`switch to ${v.label.toLowerCase()}`)) {
      ctx.switchView(v.key);
      return ctx.reply(`Switched to ${v.label} view.`);
    }
  }
  const customView = ctx.customViews.find(v =>
    lower === v.name.toLowerCase() || lower.startsWith(`switch to ${v.name.toLowerCase()}`)
  );
  if (customView) {
    ctx.switchView(`custom:${customView.name}`);
    return ctx.reply(`Switched to ${customView.name} view.`);
  }

  // -- Hide/show done --
  if (/^(hide done|hide done tasks|hide completed)$/.test(lower)) {
    ctx.setHideDone(true);
    return ctx.reply("Hiding done tasks.");
  }
  if (/^(show done|show done tasks|show all|show completed)$/.test(lower)) {
    ctx.setHideDone(false);
    return ctx.reply("Showing all tasks.");
  }

  // -- Sort commands --
  if (/^sort by (due|due date|deadline)/.test(lower)) {
    ctx.setSortBy("due");
    return ctx.reply("Sorting by due date.");
  }
  if (/^sort by (status|state)/.test(lower)) {
    ctx.setSortBy("status");
    return ctx.reply("Sorting by status.");
  }
  if (/^sort by (project|file)/.test(lower)) {
    ctx.setSortBy("project");
    return ctx.reply("Sorting by project.");
  }
  if (/^(sort by default|reset sort|unsort|clear sort)/.test(lower)) {
    ctx.setSortBy("default");
    return ctx.reply("Reset to default sort.");
  }
  if (/^group by file/.test(lower)) {
    ctx.switchView("projects");
    return ctx.reply("Switched to Projects view (grouped by file).");
  }

  // -- Project filter --
  const showOnlyMatch = lower.match(/^show only (\w+)( tasks)?$/);
  if (showOnlyMatch) {
    ctx.setProjectFilter(showOnlyMatch[1]!);
    return ctx.reply(`Showing only "${showOnlyMatch[1]}" tasks.`);
  }
  if (/^(clear filter|show all projects|reset filter)/.test(lower)) {
    ctx.setProjectFilter("");
    ctx.setSearchFilter("");
    return ctx.reply("Filters cleared.");
  }

  // -- Edit task by number --
  const editMatch = lower.match(/^edit (?:task )?(\d+) to ['"]?(.+?)['"]?$/);
  if (editMatch) {
    const idx = parseInt(editMatch[1]!) - 1;
    const task = ctx.visibleTasks[idx];
    if (!task) return ctx.reply(`No task #${idx + 1}.`);
    ctx.editTaskContent(task, editMatch[2]!);
    return ctx.reply(`Edited task #${idx + 1}.`);
  }

  // -- Delete task by number --
  const deleteMatch = lower.match(/^delete (?:task )?(\d+)$/);
  if (deleteMatch) {
    const idx = parseInt(deleteMatch[1]!) - 1;
    const task = ctx.visibleTasks[idx];
    if (!task) return ctx.reply(`No task #${idx + 1}.`);
    try {
      const before = readFileSync(task.filePath, "utf-8");
      const lines = before.split("\n");
      const after = lines.filter((_, i) => i + 1 !== task.lineNumber).join("\n");
      ctx.writeFileWithUndo(task.filePath, before, after, `delete "${task.content}"`);
      return ctx.reply(`Deleted "${task.content}" (u to undo).`);
    } catch (err: any) {
      return ctx.reply(`Delete failed: ${err.message || String(err)}`);
    }
  }

  // -- Tag/untag --
  const tagMatch = lower.match(/^(tag|untag|remove tag from) (?:task )?(\d+) (?:with |as |from )?@?([\w-]+)/);
  if (tagMatch) {
    const op = tagMatch[1]!;
    const idx = parseInt(tagMatch[2]!) - 1;
    const tag = tagMatch[3]!;
    const task = ctx.visibleTasks[idx];
    if (!task) return ctx.reply(`No task #${idx + 1}.`);
    const tags = new Set(task.tags);
    if (op === "tag") tags.add(tag);
    else tags.delete(tag);
    const tagComment = tags.size > 0 ? ` <!-- tags:${Array.from(tags).join(",")} -->` : "";
    let newRaw = task.raw;
    if (/<!--\s*tags:[\w,-]+\s*-->/.test(newRaw)) {
      newRaw = tagComment
        ? newRaw.replace(/<!--\s*tags:[\w,-]+\s*-->/, tagComment.trim())
        : newRaw.replace(/\s*<!--\s*tags:[\w,-]+\s*-->/, "");
    } else if (tagComment) {
      newRaw = newRaw.trimEnd() + tagComment;
    }
    ctx.updateLine(task.filePath, task.lineNumber, newRaw, `${op} "${task.content}"`);
    return ctx.reply(`${op === "tag" ? "Tagged" : "Untagged"} task #${idx + 1} ${tag}.`);
  }

  // -- Mark task done by number --
  const markMatch = lower.match(/^mark (?:task )?(\d+) (?:as )?(done|open|complete|incomplete)/);
  if (markMatch) {
    const idx = parseInt(markMatch[1]!) - 1;
    if (idx < 0 || idx >= ctx.visibleTasks.length) return ctx.reply(`No task #${idx + 1}. You have ${ctx.visibleTasks.length} visible tasks.`);
    const task = ctx.visibleTasks[idx]!;
    const wantDone = markMatch[2] === "done" || markMatch[2] === "complete";
    if (task.sourceType !== "checkbox") {
      return ctx.reply(`Task #${idx + 1} is a ${task.sourceType}, not a checkbox. Use "c" to convert it first.`);
    }
    const marker = wantDone ? "x" : " ";
    const today = new Date().toISOString().slice(0, 10);
    let newRaw = task.raw.replace(/\[[ x/]\]/, `[${marker}]`);
    if (wantDone && !newRaw.includes("<!-- done:")) newRaw = newRaw.trimEnd() + ` <!-- done:${today} -->`;
    if (!wantDone) newRaw = newRaw.replace(/\s*<!--\s*done:\d{4}-\d{2}-\d{2}\s*-->/, "");
    ctx.updateLine(task.filePath, task.lineNumber, newRaw);
    return ctx.reply(`Marked "${task.content}" as ${wantDone ? "done" : "open"}.`);
  }

  // -- Set due date --
  const dueMatch = lower.match(/^set due (?:date )?(?:for )?['"]?(.+?)['"]? to (\S+)/);
  if (dueMatch) {
    const query = dueMatch[1]!.toLowerCase();
    const dateStr = resolveDate(dueMatch[2]!);
    const task = ctx.tasks.find(t => t.content.toLowerCase().includes(query));
    if (!task) return ctx.reply(`No task matching "${query}".`);
    let newRaw = task.raw;
    if (task.dueDate) {
      newRaw = newRaw.replace(/<!--\s*due:\d{4}-\d{2}-\d{2}\s*-->/, `<!-- due:${dateStr} -->`);
      newRaw = newRaw.replace(/@due\(\d{4}-\d{2}-\d{2}\)/, `@due(${dateStr})`);
    } else {
      newRaw = newRaw.trimEnd() + ` <!-- due:${dateStr} -->`;
    }
    ctx.updateLine(task.filePath, task.lineNumber, newRaw);
    return ctx.reply(`Set due date for "${task.content}" to ${dateStr}.`);
  }

  // -- Move tasks to next week --
  if (/^move .+ to next week/.test(lower)) {
    if (/^move marked to next week/.test(lower)) {
      const marked = ctx.visibleTasks.filter(t => ctx.selectedIds.has(t.id));
      if (marked.length === 0) return ctx.reply("No marked tasks. Press m on tasks first.");
      const nextMon = new Date();
      nextMon.setDate(nextMon.getDate() + (8 - nextMon.getDay()) % 7 || 7);
      const dateStr = nextMon.toISOString().slice(0, 10);
      for (const task of marked) {
        let newRaw = task.raw;
        if (task.dueDate) newRaw = newRaw.replace(/<!--\s*due:\d{4}-\d{2}-\d{2}\s*-->/, `<!-- due:${dateStr} -->`);
        else newRaw = newRaw.trimEnd() + ` <!-- due:${dateStr} -->`;
        ctx.updateLine(task.filePath, task.lineNumber, newRaw, `move "${task.content}"`);
      }
      return ctx.reply(`Moved ${marked.length} marked task(s) to next week (${dateStr}).`);
    }
    const queryPart = lower.replace(/^move /, "").replace(/ to next week$/, "").replace(/all /, "").trim();
    const nextMon = new Date();
    nextMon.setDate(nextMon.getDate() + (8 - nextMon.getDay()) % 7 || 7);
    const dateStr = nextMon.toISOString().slice(0, 10);
    const matching = ctx.tasks.filter(t => t.content.toLowerCase().includes(queryPart) || t.project.toLowerCase().includes(queryPart));
    if (matching.length === 0) return ctx.reply(`No tasks matching "${queryPart}".`);
    for (const task of matching) {
      let newRaw = task.raw;
      if (task.dueDate) {
        newRaw = newRaw.replace(/<!--\s*due:\d{4}-\d{2}-\d{2}\s*-->/, `<!-- due:${dateStr} -->`);
      } else {
        newRaw = newRaw.trimEnd() + ` <!-- due:${dateStr} -->`;
      }
      ctx.updateLine(task.filePath, task.lineNumber, newRaw);
    }
    return ctx.reply(`Moved ${matching.length} task(s) to next week (${dateStr}).`);
  }

  // -- Add task to file --
  const addMatch = lower.match(/^add ['"]?(.+?)['"]?\s+to\s+(\S+)/);
  if (addMatch) {
    const taskText = addMatch[1]!;
    const fileName = addMatch[2]!.endsWith(".md") ? addMatch[2]! : addMatch[2] + ".md";
    const filePath = join(ctx.watchedDir, fileName);
    try {
      let existing = "";
      try { existing = readFileSync(filePath, "utf-8"); } catch {}
      const line = `- [ ] ${taskText}\n`;
      const updated = existing ? existing.trimEnd() + "\n" + line : line;
      ctx.writeFileWithUndo(filePath, existing, updated, `add "${taskText}"`);
      return ctx.reply(`Added "${taskText}" to ${fileName}.`);
    } catch (err: any) {
      return ctx.reply(`Failed: ${err.message}`);
    }
  }

  // -- Quick stats --
  if (/overdue|what's overdue|what is overdue/.test(lower)) {
    const overdue = ctx.tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "done");
    if (overdue.length === 0) return ctx.reply("No overdue tasks!");
    const list = overdue.slice(0, 5).map(t => `${t.content} (${t.dueDate})`).join(", ");
    return ctx.reply(`${overdue.length} overdue: ${list}`);
  }

  if (/focus.*(today|now)|what should i/i.test(lower)) {
    const today = new Date().toISOString().slice(0, 10);
    const urgent = ctx.tasks.filter(t => t.status !== "done" && t.dueDate && t.dueDate <= today);
    const inProgress = ctx.tasks.filter(t => t.status === "in_progress");
    const items = [...urgent, ...inProgress].slice(0, 5);
    if (items.length === 0) return ctx.reply("Nothing urgent today. Pick something from your inbox!");
    const list = items.map(t => t.content).join(", ");
    return ctx.reply(`Focus on: ${list}`);
  }

  if (/summarize.*week|weekly|this week/i.test(lower)) {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const weekEnd = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
    const doneThisWeek = ctx.tasks.filter(t => t.doneDate && t.doneDate >= weekAgo);
    const dueThisWeek = ctx.tasks.filter(t => t.dueDate && t.dueDate >= weekAgo && t.dueDate <= weekEnd && t.status !== "done");
    return ctx.reply(`This week: ${doneThisWeek.length} completed, ${dueThisWeek.length} due. ${ctx.tasks.filter(t => t.status !== "done").length} total open.`);
  }

  if (/summary|summarize|how many/i.test(lower)) {
    const total = ctx.tasks.length;
    const done = ctx.tasks.filter(t => t.status === "done").length;
    const overdue = ctx.tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "done").length;
    const projects = new Set(ctx.tasks.map(t => t.project)).size;
    return ctx.reply(`${total} tasks across ${projects} projects. ${done} done, ${overdue} overdue, ${total - done} open.`);
  }

  // -- Color themes --
  const themeMatch = lower.match(/^(theme|color|colour)\s+(default|warm|cool|mono)/);
  if (themeMatch) {
    ctx.setTheme(themeMatch[2] as ThemeName);
    return ctx.reply(`Theme set to "${themeMatch[2]}".`);
  }

  // -- Custom view creation --
  if (/^create view\b/.test(lower)) {
    const desc = message.replace(/^create view\s*/i, "").trim();
    if (!desc) return ctx.reply("Usage: create view <description>. Example: create view priority by color");
    return ctx.createCustomView(desc);
  }

  // -- Fallback: AI chat --
  return ctx.aiChat(message);
}
