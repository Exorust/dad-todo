import { Box, Flex, Heading, Text, ScrollArea } from "@radix-ui/themes";
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

export function CalendarView({ tasks, buckets, config, onToggle, onConvert, loading }: Props) {
  const hasBuckets = Object.keys(buckets).length > 0;

  if (loading && !hasBuckets) {
    return (
      <Flex align="center" justify="center" style={{ height: "100%" }}>
        <Text color="gray">Scheduling tasks...</Text>
      </Flex>
    );
  }

  const dated = Object.entries(buckets)
    .filter(([key]) => key !== "undated")
    .sort(([a], [b]) => a.localeCompare(b));
  const undated = buckets["undated"] ?? [];

  const today = new Date().toISOString().slice(0, 10);

  return (
    <ScrollArea style={{ height: "100%" }}>
      <Flex direction="column" gap="3" p="4">
        {dated.map(([date, indices]) => {
          const dayTasks = indices.map((i) => tasks[i]).filter(Boolean) as Task[];
          const isToday = date === today;
          const d = new Date(date + "T12:00:00");
          const label = d.toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          });
          return (
            <Box key={date}>
              <Flex align="center" gap="2" mb="2">
                <Heading size="2" color={isToday ? "blue" : undefined}>
                  {label}
                </Heading>
                {isToday && (
                  <Text size="1" color="blue" weight="bold">TODAY</Text>
                )}
              </Flex>
              <TaskList tasks={dayTasks} config={config} onToggle={onToggle} onConvert={onConvert} />
            </Box>
          );
        })}

        {undated.length > 0 && (
          <Box mt="4">
            <Heading size="2" color="gray" mb="2">Undated</Heading>
            <TaskList
              tasks={undated.map((i) => tasks[i]).filter(Boolean) as Task[]}
              config={config}
              onToggle={onToggle}
            />
          </Box>
        )}
      </Flex>
    </ScrollArea>
  );
}
