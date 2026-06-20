import { Box, Flex, Text, Checkbox } from "@radix-ui/themes";
import type { Task, ViewConfig, Buckets } from "../types";

interface Props {
  tasks: Task[];
  buckets: Buckets;
  config: ViewConfig;
  onToggle: (task: Task) => void;
  onConvert?: (task: Task) => void;
  loading: boolean;
}

const COLORS = [
  "#fef3c7", "#dbeafe", "#fce7f3", "#d1fae5", "#ede9fe",
  "#fed7aa", "#e0e7ff", "#fecaca", "#cffafe", "#f3e8ff",
];

export function PostItView({ tasks, buckets, config, onToggle, loading }: Props) {
  const hasBuckets = Object.keys(buckets).length > 0;

  if (loading && !hasBuckets) {
    return (
      <Flex align="center" justify="center" style={{ height: "100%" }}>
        <Text color="gray">Clustering tasks...</Text>
      </Flex>
    );
  }

  const clusters = Object.entries(buckets);
  const size = (config as any).cardSize === "large" ? 180 : (config as any).cardSize === "small" ? 120 : 150;

  return (
    <Box p="4" style={{ height: "100%", overflow: "auto" }}>
      {clusters.map(([clusterName, indices], ci) => {
        const color = COLORS[ci % COLORS.length]!;
        const clusterTasks = indices.map((i) => tasks[i]).filter(Boolean) as Task[];
        return (
          <Box key={clusterName} mb="4">
            <Text size="2" weight="bold" mb="2" style={{ display: "block", textTransform: "capitalize" }}>
              {clusterName.replace(/_/g, " ")}
            </Text>
            <Flex gap="3" wrap="wrap">
              {clusterTasks.map((t) => (
                <Box
                  key={t.id}
                  p="3"
                  style={{
                    width: size,
                    minHeight: size,
                    background: color,
                    borderRadius: 4,
                    boxShadow: "2px 2px 6px rgba(0,0,0,0.1)",
                    transform: `rotate(${(Math.random() - 0.5) * 4}deg)`,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <Flex gap="1" align="start">
                    <Checkbox
                      checked={t.status === "done"}
                      onCheckedChange={() => onToggle(t)}
                      size="1"
                    />
                    <Text
                      size="1"
                      style={{
                        color: "#1a1a1a",
                        wordBreak: "break-word",
                        textDecoration: t.status === "done" ? "line-through" : "none",
                      }}
                    >
                      {t.content}
                    </Text>
                  </Flex>
                  {t.dueDate && (
                    <Text size="1" style={{ color: "#666", marginTop: "auto" }}>{t.dueDate}</Text>
                  )}
                </Box>
              ))}
            </Flex>
          </Box>
        );
      })}
    </Box>
  );
}
