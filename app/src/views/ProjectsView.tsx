import { useState } from "react";
import { Box, Flex, Heading, Text, ScrollArea, Badge, IconButton } from "@radix-ui/themes";
import { ChevronDownIcon, ChevronRightIcon, FileTextIcon } from "@radix-ui/react-icons";
import { TaskList } from "../components/TaskList";
import type { Task, ViewConfig } from "../types";

interface Props {
  tasks: Task[];
  config: ViewConfig;
  onToggle: (task: Task) => void;
  onConvert?: (task: Task) => void;
}

function FileSection({ heading, tasks, config, onToggle, onConvert }: {
  heading: string;
  tasks: Task[];
  config: ViewConfig;
  onToggle: (task: Task) => void;
  onConvert?: (task: Task) => void;
}) {
  const [open, setOpen] = useState(true);
  const doneCount = tasks.filter(t => t.status === "done").length;

  return (
    <Box>
      <Flex
        align="center"
        gap="2"
        py="1"
        style={{ cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen(o => !o)}
      >
        <IconButton variant="ghost" size="1" style={{ pointerEvents: "none" }}>
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </IconButton>
        <Text size="2" weight="medium" color="gray">{heading}</Text>
        <Badge size="1" variant="soft" color="gray">
          {doneCount > 0 ? `${doneCount}/${tasks.length}` : tasks.length}
        </Badge>
      </Flex>
      {open && (
        <Box pl="5" pt="1">
          <TaskList tasks={tasks} config={config} onToggle={onToggle} onConvert={onConvert} />
        </Box>
      )}
    </Box>
  );
}

export function ProjectsView({ tasks, config, onToggle, onConvert }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Group by file (project)
  const fileGroups = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = t.project || "Unsorted";
    if (!fileGroups.has(key)) fileGroups.set(key, []);
    fileGroups.get(key)!.push(t);
  }

  const toggleFile = (proj: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(proj) ? next.delete(proj) : next.add(proj);
      return next;
    });
  };

  return (
    <ScrollArea style={{ height: "100%" }}>
      <Flex direction="column" gap="4" p="4">
        {[...fileGroups.entries()].map(([project, fileTasks]) => {
          const isOpen = !collapsed.has(project);
          const doneCount = fileTasks.filter(t => t.status === "done").length;

          // Sub-group by heading within each file
          const headingGroups: { heading: string; tasks: Task[] }[] = [];
          for (const t of fileTasks) {
            const h = t.heading || "";
            const last = headingGroups[headingGroups.length - 1];
            if (last && last.heading === h) {
              last.tasks.push(t);
            } else {
              headingGroups.push({ heading: h, tasks: [t] });
            }
          }
          const hasSubHeadings = headingGroups.length > 1 || headingGroups[0]?.heading;

          return (
            <Box key={project}>
              <Flex
                align="center"
                gap="2"
                pb="2"
                style={{ cursor: "pointer", userSelect: "none" }}
                onClick={() => toggleFile(project)}
              >
                <IconButton variant="ghost" size="1" style={{ pointerEvents: "none" }}>
                  {isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
                </IconButton>
                <FileTextIcon />
                <Heading size="3" style={{ margin: 0 }}>{project}</Heading>
                <Badge size="1" variant="soft">
                  {doneCount > 0 ? `${doneCount}/${fileTasks.length} done` : `${fileTasks.length} tasks`}
                </Badge>
              </Flex>
              {isOpen && (
                <Flex direction="column" gap="3" pl="3">
                  {hasSubHeadings
                    ? headingGroups.map((g, i) => (
                        <FileSection
                          key={`${project}-${g.heading}-${i}`}
                          heading={g.heading || "General"}
                          tasks={g.tasks}
                          config={config}
                          onToggle={onToggle}
                          onConvert={onConvert}
                        />
                      ))
                    : <TaskList tasks={fileTasks} config={config} onToggle={onToggle} onConvert={onConvert} />
                  }
                </Flex>
              )}
            </Box>
          );
        })}
        {tasks.length === 0 && (
          <Text color="gray" size="2">No tasks found. Add some checkboxes to your markdown files.</Text>
        )}
      </Flex>
    </ScrollArea>
  );
}
