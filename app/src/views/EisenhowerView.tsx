import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { TaskList } from "../components/TaskList";
import type { Task, ViewConfig, Buckets } from "../types";

interface Props {
  tasks: Task[];
  buckets: Buckets;
  config: ViewConfig;
  onToggle: (task: Task) => void;
  onConvert?: (task: Task) => void;
  loading: boolean;
}

const QUADRANTS = [
  { key: "urgent_important", label: "Do First", sub: "Urgent + Important", color: "#ef4444" },
  { key: "important_not_urgent", label: "Schedule", sub: "Important, Not Urgent", color: "#3b82f6" },
  { key: "urgent_not_important", label: "Delegate", sub: "Urgent, Not Important", color: "#f59e0b" },
  { key: "neither", label: "Eliminate", sub: "Neither", color: "#9ca3af" },
];

export function EisenhowerView({ tasks, buckets, config, onToggle, onConvert, loading }: Props) {
  const hasBuckets = Object.keys(buckets).length > 0;

  if (loading && !hasBuckets) {
    return (
      <Flex align="center" justify="center" style={{ height: "100%" }}>
        <Text color="gray">Categorizing tasks...</Text>
      </Flex>
    );
  }

  return (
    <Box
      p="3"
      style={{
        height: "100%",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        gap: 12,
      }}
    >
      {QUADRANTS.map((q) => {
        const indices = buckets[q.key] ?? [];
        const qTasks = indices.map((i) => tasks[i]).filter(Boolean) as Task[];
        return (
          <Box
            key={q.key}
            p="3"
            style={{
              borderRadius: 12,
              border: `2px solid ${q.color}22`,
              background: `${q.color}08`,
              overflow: "auto",
            }}
          >
            <Heading size="2" style={{ color: q.color }}>{q.label}</Heading>
            <Text size="1" color="gray" mb="2">{q.sub}</Text>
            <Box mt="2">
              <TaskList tasks={qTasks} config={config} onToggle={onToggle} onConvert={onConvert} />
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
