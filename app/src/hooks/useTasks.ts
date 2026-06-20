import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Task } from "../types";

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<{ ok: boolean; tasks: Task[] }>("parse_files");
      if (result.ok) setTasks(result.tasks);
    } catch (err) {
      console.error("[dadtodo] parse failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    let unlisten: (() => void) | undefined;
    listen("files-changed", () => reload()).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, [reload]);

  const toggleTask = useCallback(
    async (task: Task) => {
      const newStatus = task.status === "done" ? "open" : "done";
      const marker = newStatus === "done" ? "x" : " ";
      const today = new Date().toISOString().slice(0, 10);

      let newRaw = task.raw.replace(/\[[ x/]\]/, `[${marker}]`);
      if (newStatus === "done" && !newRaw.includes("<!-- done:")) {
        newRaw = newRaw.trimEnd() + ` <!-- done:${today} -->`;
      }
      if (newStatus === "open") {
        newRaw = newRaw.replace(/\s*<!--\s*done:\d{4}-\d{2}-\d{2}\s*-->/, "");
      }

      await invoke("update_task", {
        filePath: task.filePath,
        lineNumber: task.lineNumber,
        newContent: newRaw,
      });
    },
    []
  );

  const convertToTodo = useCallback(
    async (task: Task) => {
      // Rewrite the raw line as a checkbox item
      const raw = task.raw;
      let newRaw: string;
      if (/^\s*[-*+]\s+/.test(raw)) {
        // Bullet: "- item" -> "- [ ] item"
        newRaw = raw.replace(/^(\s*[-*+])\s+/, "$1 [ ] ");
      } else if (/^\s*\d+[.)]\s+/.test(raw)) {
        // Numbered: "1. item" -> "- [ ] item"
        newRaw = raw.replace(/^(\s*)\d+[.)]\s+/, "$1- [ ] ");
      } else {
        // Plain text: "item" -> "- [ ] item"
        newRaw = raw.replace(/^(\s*)/, "$1- [ ] ");
      }
      await invoke("update_task", {
        filePath: task.filePath,
        lineNumber: task.lineNumber,
        newContent: newRaw,
      });
    },
    []
  );

  const createTask = useCallback(
    async (filePath: string, content: string) => {
      await invoke("create_task", { filePath, content });
    },
    []
  );

  return { tasks, loading, reload, toggleTask, convertToTodo, createTask };
}
