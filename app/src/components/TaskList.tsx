import { useState } from "react";
import { Flex, Button, Text } from "@radix-ui/themes";
import { TaskCard } from "./TaskCard";
import type { Task, ViewConfig } from "../types";

const PAGE_SIZE = 20;

interface Props {
  tasks: Task[];
  config: ViewConfig;
  onToggle: (task: Task) => void;
  onConvert?: (task: Task) => void;
}

export function TaskList({ tasks, config, onToggle, onConvert }: Props) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const visible = tasks.slice(0, shown);
  const remaining = tasks.length - shown;

  return (
    <Flex direction="column" gap="2">
      {visible.map((t) => (
        <TaskCard key={t.id} task={t} config={config} onToggle={onToggle} onConvert={onConvert} />
      ))}
      {remaining > 0 && (
        <Button
          variant="ghost"
          size="1"
          onClick={() => setShown((s) => s + PAGE_SIZE)}
        >
          <Text size="1" color="gray">Show {Math.min(remaining, PAGE_SIZE)} more ({remaining} remaining)</Text>
        </Button>
      )}
    </Flex>
  );
}
