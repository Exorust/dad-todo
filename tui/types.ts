import type { Buckets } from "./categorizer";

export const VIEWS = [
  { key: "today", label: "Today", num: "1" },
  { key: "projects", label: "Projects", num: "2" },
  { key: "gtd", label: "GTD", num: "3" },
  { key: "eisenhower", label: "Eisenhower", num: "4" },
  { key: "kanban", label: "Kanban", num: "5" },
  { key: "postit", label: "Post-Its", num: "6" },
  { key: "calendar", label: "Calendar", num: "7" },
  { key: "mindmap", label: "Mind Map", num: "8" },
] as const;

export type ViewName = (typeof VIEWS)[number]["key"];
export type ActiveViewName = ViewName | `custom:${string}`;
export type SortBy = "default" | "due" | "status" | "project";

export type UndoEntry = {
  filePath: string;
  before: string;
  after: string;
  description: string;
};

export type StatusKind = "info" | "success" | "warning" | "error";

export type CustomView = {
  name: string;
  categorizationPrompt: string;
  buckets?: Buckets;
};

export type ThemeName = "default" | "warm" | "cool" | "mono";

export interface ThemeColors {
  accent: (s: string) => string;
  heading: (s: string) => string;
  selected: (s: string) => string;
  done: (s: string) => string;
  overdue: (s: string) => string;
  muted: (s: string) => string;
  tab: (s: string) => string;
  tabActive: (s: string) => string;
}
