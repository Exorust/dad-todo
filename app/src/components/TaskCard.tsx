import { useState, useCallback } from "react";
import { Box, Text, Flex, Checkbox, Badge } from "@radix-ui/themes";
import type { Task, ViewConfig } from "../types";

interface Props {
  task: Task;
  config: ViewConfig;
  onToggle: (task: Task) => void;
  onConvert?: (task: Task) => void;
}

const DENSITY_PAD = { compact: "2" as const, normal: "3" as const, spacious: "4" as const };

const SOURCE_BADGE: Record<string, { label: string; color: "gray" | "blue" | "green" | "orange" }> = {
  bullet: { label: "list", color: "gray" },
  numbered: { label: "#", color: "gray" },
  plain: { label: "text", color: "gray" },
};

export function TaskCard({ task, config, onToggle, onConvert }: Props) {
  const pad = DENSITY_PAD[config.density] ?? "3";
  const isCheckbox = task.sourceType === "checkbox";
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContext = useCallback((e: React.MouseEvent) => {
    if (isCheckbox) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }, [isCheckbox]);

  const handleConvert = useCallback(() => {
    setMenu(null);
    onConvert?.(task);
  }, [task, onConvert]);

  return (
    <>
      <Box
        p={pad}
        onContextMenu={handleContext}
        style={{
          background: "var(--color-surface)",
          borderRadius: 8,
          border: "1px solid var(--gray-a5)",
          opacity: task.status === "done" ? 0.6 : 1,
        }}
      >
        <Flex gap="2" align="start">
          {isCheckbox ? (
            <Checkbox
              checked={task.status === "done"}
              onCheckedChange={() => onToggle(task)}
              style={{ marginTop: 2 }}
            />
          ) : (
            <Box
              onClick={() => onConvert?.(task)}
              style={{
                width: 16,
                height: 16,
                borderRadius: 4,
                border: "1.5px solid var(--gray-7)",
                marginTop: 2,
                flexShrink: 0,
                cursor: "pointer",
              }}
              title="Click to convert to todo"
            />
          )}
          <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 0 }}>
            <Text
              size="2"
              style={{
                textDecoration: task.status === "done" ? "line-through" : "none",
                wordBreak: "break-word",
              }}
            >
              {task.content}
            </Text>
            <Flex gap="2" wrap="wrap" align="center">
              {config.cardFields.includes("project") && task.project && (
                <Text size="1" color="gray">{task.project}</Text>
              )}
              {config.cardFields.includes("dueDate") && task.dueDate && (
                <Text size="1" color="blue">{task.dueDate}</Text>
              )}
              {config.cardFields.includes("tags") && task.tags.length > 0 && (
                <Text size="1" color="purple">{task.tags.join(", ")}</Text>
              )}
              {task.status === "in_progress" && (
                <Text size="1" color="orange">in progress</Text>
              )}
              {!isCheckbox && SOURCE_BADGE[task.sourceType] && (
                <Badge size="1" color={SOURCE_BADGE[task.sourceType]!.color} variant="outline">
                  {SOURCE_BADGE[task.sourceType]!.label}
                </Badge>
              )}
            </Flex>
          </Flex>
        </Flex>
      </Box>

      {menu && (
        <>
          <Box
            onClick={() => setMenu(null)}
            style={{ position: "fixed", inset: 0, zIndex: 999 }}
          />
          <Box
            style={{
              position: "fixed",
              left: menu.x,
              top: menu.y,
              zIndex: 1000,
              background: "var(--color-surface)",
              border: "1px solid var(--gray-a5)",
              borderRadius: 8,
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              padding: 4,
              minWidth: 160,
            }}
          >
            <Box
              onClick={handleConvert}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                cursor: "pointer",
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "var(--gray-a3)"; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.background = "transparent"; }}
            >
              <Text size="2">Convert to todo</Text>
            </Box>
          </Box>
        </>
      )}
    </>
  );
}
