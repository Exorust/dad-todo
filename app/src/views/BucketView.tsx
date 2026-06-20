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
  structureType: "columns" | "grid" | "canvas" | "tree" | "list";
}

const COLORS = ["blue", "purple", "green", "orange", "red", "cyan"] as const;

export function BucketView({ tasks, buckets, config, onToggle, onConvert, loading, structureType }: Props) {
  if (loading) {
    return (
      <Flex align="center" justify="center" style={{ height: "100%" }}>
        <Text color="gray">Categorizing tasks...</Text>
      </Flex>
    );
  }

  const entries = Object.entries(buckets);
  const isColumns = structureType === "columns" || structureType === "grid";

  return (
    <ScrollArea style={{ height: "100%" }}>
      <Flex
        direction={isColumns ? "row" : "column"}
        gap="4"
        p="4"
        style={{ minHeight: "100%" }}
      >
        {entries.map(([name, indices], i) => {
          const color = COLORS[i % COLORS.length]!;
          const bucketTasks = indices.map((idx) => tasks[idx]).filter(Boolean) as Task[];
          return (
            <Flex
              key={name}
              direction="column"
              gap="2"
              style={{
                flex: isColumns ? 1 : undefined,
                minWidth: isColumns ? 180 : undefined,
                background: isColumns ? "var(--gray-a2)" : undefined,
                borderRadius: 10,
                padding: isColumns ? 12 : 0,
              }}
            >
              <Flex align="center" gap="2">
                <Heading size="2" style={{ textTransform: "capitalize" }}>
                  {name.replace(/_/g, " ")}
                </Heading>
                <Badge color={color} size="1">{bucketTasks.length}</Badge>
              </Flex>
              <TaskList tasks={bucketTasks} config={config} onToggle={onToggle} onConvert={onConvert} />
            </Flex>
          );
        })}
      </Flex>
    </ScrollArea>
  );
}
