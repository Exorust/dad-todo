import { Flex, Heading, Text, ScrollArea, Badge } from "@radix-ui/themes";
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

const GTD_BUCKETS = [
  { key: "inbox", label: "Inbox", color: "gray" as const },
  { key: "next_actions", label: "Next Actions", color: "blue" as const },
  { key: "waiting_for", label: "Waiting For", color: "orange" as const },
  { key: "someday_maybe", label: "Someday / Maybe", color: "purple" as const },
  { key: "done", label: "Done", color: "green" as const },
];

export function GtdView({ tasks, buckets, config, onToggle, onConvert, loading }: Props) {
  const hasBuckets = Object.keys(buckets).length > 0;

  if (loading && !hasBuckets) {
    return (
      <Flex align="center" justify="center" style={{ height: "100%" }}>
        <Text color="gray">Categorizing tasks...</Text>
      </Flex>
    );
  }

  return (
    <ScrollArea style={{ height: "100%" }}>
      <Flex gap="4" p="4" style={{ minHeight: "100%" }}>
        {GTD_BUCKETS.map((bucket) => {
          const indices = buckets[bucket.key] ?? [];
          const bucketTasks = indices.map((i) => tasks[i]).filter(Boolean) as Task[];
          return (
            <Flex key={bucket.key} direction="column" gap="2" style={{ flex: 1, minWidth: 180 }}>
              <Flex align="center" gap="2">
                <Heading size="2">{bucket.label}</Heading>
                <Badge color={bucket.color} size="1">{bucketTasks.length}</Badge>
              </Flex>
              <TaskList tasks={bucketTasks} config={config} onToggle={onToggle} onConvert={onConvert} />
            </Flex>
          );
        })}
      </Flex>
    </ScrollArea>
  );
}
