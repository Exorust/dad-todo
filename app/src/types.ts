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

export type ViewName =
  | "projects"
  | "gtd"
  | "postit"
  | "eisenhower"
  | "kanban"
  | "calendar"
  | "mindmap";

export interface CustomViewDef {
  id: string;
  name: string;
  icon: string;
  structureType: "columns" | "grid" | "canvas" | "tree" | "list";
  buckets: string[];
  categorizationPrompt: string;
}

export interface ViewConfig {
  cardFields: string[];
  sortBy: string;
  sortDirection: "asc" | "desc";
  density: "compact" | "normal" | "spacious";
  accentColor: string;
  [key: string]: unknown;
}

export type Buckets = Record<string, number[]>;

export const DEFAULT_VIEW_CONFIG: ViewConfig = {
  cardFields: ["content", "dueDate", "project"],
  sortBy: "content",
  sortDirection: "asc",
  density: "normal",
  accentColor: "blue",
};
