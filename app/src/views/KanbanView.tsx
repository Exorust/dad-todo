import { Flex, Heading, Text, Badge, ScrollArea } from "@radix-ui/themes";
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

const COLUMNS = [
  { key: "todo", label: "To Do", color: "gray" as const },
  { key: "in_progress", label: "In Progress", color: "orange" as const },
  { key: "blocked", label: "Blocked", color: "red" as const },
  { key: "done", label: "Done", color: "green" as const },
];

export function KanbanView({ tasks, buckets, config, onToggle, onConvert, loading }: Props) {
  const hasBuckets = Object.keys(buckets).length > 0;

  if (loading && !hasBuckets) {
    return (
      <Flex align="center" justify="center" style={{ height: "100%" }}>
        <Text color="gray">Categorizing tasks...</Text>
      </Flex>
    );
  }

  const usedColumns = COLUMNS.filter((col) => (buckets[col.key]?.length ?? 0) > 0);
  const displayColumns = usedColumns.length > 0 ? usedColumns : COLUMNS.filter((c) => c.key !== "blocked");

  return (
    <ScrollArea style={{ height: "100%" }}>
      <Flex gap="4" p="4" style={{ minHeight: "100%" }}>
        {displayColumns.map((col) => {
          const indices = buckets[col.key] ?? [];
          const colTasks = indices.map((i) => tasks[i]).filter(Boolean) as Task[];
          return (
            <Flex
              key={col.key}
              direction="column"
              gap="2"
              style={{
                flex: 1,
                minWidth: 200,
                background: "var(--gray-a2)",
                borderRadius: 10,
                padding: 12,
              }}
            >
              <Flex align="center" gap="2" mb="1">
                <Heading size="2">{col.label}</Heading>
                <Badge color={col.color} size="1">{colTasks.length}</Badge>
              </Flex>
              <TaskList tasks={colTasks} config={config} onToggle={onToggle} onConvert={onConvert} />
            </Flex>
          );
        })}
      </Flex>
    </ScrollArea>
  );
}
