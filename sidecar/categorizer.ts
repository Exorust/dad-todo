import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { Task } from "./parser";

let cachedSession: AgentSession | null = null;

async function getSession(): Promise<AgentSession> {
  if (cachedSession) return cachedSession;
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: process.cwd(),
    resourceLoader: loader,
  });
  cachedSession = session;
  return session;
}

function extractText(message: any): string {
  if (!message?.content) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
  }
  return "";
}

async function askAI(prompt: string): Promise<string> {
  const session = await getSession();
  let result = "";
  const done = new Promise<void>((resolve) => {
    session.subscribe((e: AgentSessionEvent) => {
      if (e.type === "message_update") result = extractText((e as any).message);
      if (e.type === "agent_end") resolve();
    });
  });
  await session.prompt(prompt);
  await done;
  return result;
}

function taskSummary(tasks: Task[]): string {
  return tasks
    .map(
      (t, i) =>
        `${i}. [${t.status}] "${t.content}"${t.dueDate ? ` (due: ${t.dueDate})` : ""}${t.project ? ` (project: ${t.project})` : ""}`
    )
    .join("\n");
}

export type Buckets = Record<string, number[]>;

const VIEW_PROMPTS: Record<string, string> = {
  gtd: `Categorize each task into exactly one GTD bucket: "inbox", "next_actions", "waiting_for", "someday_maybe", or "done".
Tasks that are already marked done go in "done". For the rest, use your judgment:
- "next_actions": concrete, actionable tasks that can be done now
- "waiting_for": tasks blocked on someone else or an external event
- "someday_maybe": aspirational or low-priority items with no urgency
- "inbox": anything unclear or needing further breakdown`,

  eisenhower: `Place each task into one quadrant of the Eisenhower Matrix:
- "urgent_important": time-sensitive AND high impact
- "important_not_urgent": high impact but can be scheduled
- "urgent_not_important": time-sensitive but low impact (delegate if possible)
- "neither": low impact and no time pressure`,

  kanban: `Assign each task a Kanban status. Tasks already marked "done" go in "done", those marked "in_progress" go in "in_progress". For the rest, infer from the content:
- "todo": not started
- "in_progress": partially complete or language suggests ongoing work
- "done": completed
If a task sounds blocked, put it in "blocked".`,

  calendar: `For each task, infer a date (YYYY-MM-DD format) when it should be done or is relevant. Use any explicit due dates. For undated tasks, infer from context:
- Shopping/errands: this weekend
- Urgent mentions: today or tomorrow
- Seasonal tasks: appropriate upcoming date
If truly undatable, assign "undated".
Return the bucket key as the date string.`,

  postit: `Group tasks into 3-6 thematic clusters. Name each cluster with a short label (2-3 words). Tasks that don't fit a cluster go in "other".`,

  mindmap: `Identify 3-5 high-level goals or life areas from these tasks. Name each goal concisely (2-4 words). Assign every task to the most relevant goal. Tasks with no clear goal go in "general".`,
};

export async function categorizeTasks(
  viewName: string,
  tasks: Task[],
  customPrompt?: string
): Promise<Buckets> {
  if (tasks.length === 0) return {};

  const viewPrompt = customPrompt ?? VIEW_PROMPTS[viewName];
  if (!viewPrompt) return { all: tasks.map((_, i) => i) };

  const prompt = `You are a task categorization assistant. Given these tasks, categorize them.

${viewPrompt}

TASKS:
${taskSummary(tasks)}

Respond with ONLY valid JSON: an object where keys are bucket names and values are arrays of task indices (0-based). Every task index must appear in exactly one bucket. Example: {"bucket_a": [0, 2], "bucket_b": [1, 3]}`;

  const raw = await Promise.race([
    askAI(prompt),
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error("AI call timed out")), 20000)),
  ]);
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { uncategorized: tasks.map((_, i) => i) };
    return JSON.parse(jsonMatch[0]) as Buckets;
  } catch {
    return { uncategorized: tasks.map((_, i) => i) };
  }
}

export async function generateCustomView(description: string): Promise<{
  name: string;
  icon: string;
  structureType: string;
  buckets: string[];
  categorizationPrompt: string;
}> {
  const prompt = `You are designing a task view for a todo app. The user described this view:

"${description}"

Generate a view definition. Respond with ONLY valid JSON:
{
  "name": "Short Name",
  "icon": "one of: list, grid, columns, layers, target, clock, star, heart, flag, bookmark",
  "structureType": "one of: columns, grid, canvas, tree, list",
  "buckets": ["bucket1", "bucket2", "bucket3"],
  "categorizationPrompt": "Instructions for an AI to sort tasks into the buckets above. Be specific about what goes where."
}`;

  const raw = await askAI(prompt);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Failed to generate view definition");
  return JSON.parse(jsonMatch[0]);
}

export async function studioChat(
  message: string,
  viewName: string,
  viewConfig: Record<string, any>
): Promise<Record<string, any>> {
  const prompt = `You are a UI customization assistant for a todo app. The user is looking at the "${viewName}" view with this config:

${JSON.stringify(viewConfig, null, 2)}

They said: "${message}"

Modify the config to match their request. Respond with ONLY valid JSON - the updated config object. Only change what they asked for, keep everything else the same. Available fields:
- cardFields: array of field names to show (content, dueDate, project, tags, status)
- sortBy: "content" | "dueDate" | "project" | "status"
- sortDirection: "asc" | "desc"
- density: "compact" | "normal" | "spacious"
- accentColor: any CSS color name
- cardSize: "small" | "medium" | "large" (for postit view)
- columns: array of column names (for kanban view)`;

  const raw = await askAI(prompt);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return viewConfig;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return viewConfig;
  }
}
