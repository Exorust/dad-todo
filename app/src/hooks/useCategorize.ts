import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Task, Buckets } from "../types";

const AI_VIEWS = ["gtd", "eisenhower", "kanban", "postit", "calendar", "mindmap"];
const AI_TASK_LIMIT = 200;

function fallbackCategorize(viewName: string, tasks: Task[]): Buckets {
  const buckets: Buckets = {};
  const push = (key: string, i: number) => {
    (buckets[key] ??= []).push(i);
  };

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]!;
    switch (viewName) {
      case "gtd":
        if (t.status === "done") push("done", i);
        else if (t.tags?.includes("waiting")) push("waiting_for", i);
        else if (t.heading?.toLowerCase().includes("someday")) push("someday_maybe", i);
        else if (t.dueDate || t.status === "in_progress") push("next_actions", i);
        else push("inbox", i);
        break;
      case "eisenhower": {
        if (t.dueDate) {
          const days = (new Date(t.dueDate).getTime() - Date.now()) / 86400000;
          push(days < 3 ? "urgent_important" : "important_not_urgent", i);
        } else {
          push("neither", i);
        }
        break;
      }
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

// Fast hash: use length + sample of task IDs instead of concatenating everything
function hashTasks(tasks: Task[]): string {
  if (tasks.length === 0) return "empty";
  const first = tasks[0]!;
  const last = tasks[tasks.length - 1]!;
  const mid = tasks[Math.floor(tasks.length / 2)]!;
  return `${tasks.length}:${first.id}:${first.status}:${mid.id}:${mid.status}:${last.id}:${last.status}`;
}

export function useCategorize() {
  const cacheRef = useRef<Record<string, { hash: string; buckets: Buckets }>>({});
  const [activeBuckets, setActiveBuckets] = useState<Buckets>({});
  const [loading, setLoading] = useState(false);
  const lastHashRef = useRef("");
  const prefetchingRef = useRef(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ buckets: Buckets; viewName: string }>("tasks-updated", (e) => {
      if (e.payload.buckets && e.payload.viewName) {
        cacheRef.current[e.payload.viewName] = {
          hash: lastHashRef.current,
          buckets: e.payload.buckets,
        };
      }
    }).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  const prefetchAll = useCallback(async (tasks: Task[]) => {
    if (tasks.length === 0 || prefetchingRef.current) return;
    const hash = hashTasks(tasks);
    if (hash === lastHashRef.current) return;
    lastHashRef.current = hash;
    prefetchingRef.current = true;

    // Only send first N tasks to AI to avoid overload
    const aiTasks = tasks.length > AI_TASK_LIMIT ? tasks.slice(0, AI_TASK_LIMIT) : tasks;

    for (const viewName of AI_VIEWS) {
      const cached = cacheRef.current[viewName];
      if (cached && cached.hash === hash) continue;

      const fb = fallbackCategorize(viewName, tasks);
      cacheRef.current[viewName] = { hash, buckets: fb };

      invoke<{ ok: boolean; buckets: Buckets; source?: string }>(
        "categorize",
        { viewName, tasks: aiTasks }
      ).then((result) => {
        if (result.ok && Object.keys(result.buckets).length > 0) {
          // If AI only categorized a subset, merge with fallback for remaining tasks
          if (tasks.length > AI_TASK_LIMIT) {
            const overflow = fallbackCategorize(viewName, tasks);
            const merged: Buckets = { ...result.buckets };
            for (let i = AI_TASK_LIMIT; i < tasks.length; i++) {
              for (const [key, indices] of Object.entries(overflow)) {
                if (indices.includes(i)) {
                  (merged[key] ??= []).push(i);
                  break;
                }
              }
            }
            cacheRef.current[viewName] = { hash, buckets: merged };
          } else {
            cacheRef.current[viewName] = { hash, buckets: result.buckets };
          }
        }
      }).catch(() => {});
    }

    prefetchingRef.current = false;
  }, []);

  const switchToView = useCallback(
    (viewName: string, tasks: Task[]) => {
      const cached = cacheRef.current[viewName];
      if (cached) {
        setActiveBuckets(cached.buckets);
      } else {
        const fb = fallbackCategorize(viewName, tasks);
        cacheRef.current[viewName] = { hash: hashTasks(tasks), buckets: fb };
        setActiveBuckets(fb);
      }
      setLoading(false);
    },
    []
  );

  const categorizeCustom = useCallback(
    async (viewName: string, tasks: Task[], customPrompt: string) => {
      const fb = fallbackCategorize("postit", tasks);
      setActiveBuckets(fb);
      setLoading(true);
      try {
        const aiTasks = tasks.length > AI_TASK_LIMIT ? tasks.slice(0, AI_TASK_LIMIT) : tasks;
        const result = await invoke<{ ok: boolean; buckets: Buckets }>(
          "categorize",
          { viewName, tasks: aiTasks, customPrompt }
        );
        if (result.ok && Object.keys(result.buckets).length > 0) {
          setActiveBuckets(result.buckets);
        }
      } catch {}
      setLoading(false);
    },
    []
  );

  return {
    buckets: activeBuckets,
    loading,
    prefetchAll,
    switchToView,
    categorizeCustom,
  };
}
