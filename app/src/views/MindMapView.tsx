import { Box, Flex, Heading, Text, ScrollArea, Badge } from "@radix-ui/themes";
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

const GOAL_COLORS = ["blue", "purple", "green", "orange", "red"] as const;

export function MindMapView({ tasks, buckets, config, onToggle, onConvert, loading }: Props) {
  const hasBuckets = Object.keys(buckets).length > 0;

  if (loading && !hasBuckets) {
    return (
      <Flex align="center" justify="center" style={{ height: "100%" }}>
        <Text color="gray">Mapping your goals...</Text>
      </Flex>
    );
  }

  const goals = Object.entries(buckets);

  // ponytail: radial SVG mind map is a v2 thing; tree layout covers it
  return (
    <ScrollArea style={{ height: "100%" }}>
      <Flex direction="column" align="center" gap="5" p="4" pt="6">
        <Heading size="5" color="blue">Goals</Heading>
        <Flex gap="5" wrap="wrap" justify="center" style={{ maxWidth: 900 }}>
          {goals.map(([goal, indices], gi) => {
            const color = GOAL_COLORS[gi % GOAL_COLORS.length]!;
            const goalTasks = indices.map((i) => tasks[i]).filter(Boolean) as Task[];
            return (
              <Box
                key={goal}
                style={{
                  minWidth: 220,
                  maxWidth: 300,
                  flex: "1 1 250px",
                }}
              >
                <Flex align="center" gap="2" mb="2">
                  <Box
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: `var(--${color}-9)`,
                    }}
                  />
                  <Heading size="3" style={{ textTransform: "capitalize" }}>
                    {goal.replace(/_/g, " ")}
                  </Heading>
                  <Badge color={color} size="1">{goalTasks.length}</Badge>
                </Flex>
                <Box
                  pl="4"
                  style={{ borderLeft: `2px solid var(--${color}-6)` }}
                >
                  <TaskList tasks={goalTasks} config={config} onToggle={onToggle} onConvert={onConvert} />
                </Box>
              </Box>
            );
          })}
        </Flex>
      </Flex>
    </ScrollArea>
  );
}
