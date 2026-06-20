import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface DadTodoConfig {
  watched_dir: string;
  file_types: string[];
  parse_mode: "checkboxes_only" | "all_lists" | "everything";
  ai_configured: boolean;
  preferences?: DadTodoPreferences;
  custom_views?: DadTodoCustomView[];
  chat_history?: { role: "user" | "ai"; text: string }[];
  ai_timeout_ms?: number;
}

export interface DadTodoPreferences {
  hideDone?: boolean;
  sortBy?: "default" | "due" | "status" | "project";
  colorTheme?: "default" | "warm" | "cool" | "mono";
}

export interface DadTodoCustomView {
  name: string;
  icon?: string;
  structureType?: string;
  buckets?: string[];
  categorizationPrompt: string;
}

const CONFIG_DIR = join(process.env.HOME ?? ".", ".dadtodo");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export function loadConfig(): DadTodoConfig | null {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return null;
  }
}

export function saveConfig(config: DadTodoConfig) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function getCacheDir(): string {
  const dir = join(CONFIG_DIR, "cache");
  mkdirSync(dir, { recursive: true });
  return dir;
}
