import { Flex, IconButton, Tooltip, Separator, Text } from "@radix-ui/themes";
import {
  ListBulletIcon,
  StackIcon,
  DashboardIcon,
  GridIcon,
  ViewVerticalIcon,
  CalendarIcon,
  Share1Icon,
  MixerHorizontalIcon,
  PlusIcon,
} from "@radix-ui/react-icons";
import type { ViewName, CustomViewDef } from "../types";
import type { ReactNode } from "react";

interface Props {
  activeView: string;
  onViewChange: (view: string) => void;
  onStudioToggle: () => void;
  studioOpen: boolean;
  customViews: CustomViewDef[];
  onCreateView: () => void;
  folderName?: string;
}

const BUILT_IN_VIEWS: { id: ViewName; label: string; icon: ReactNode }[] = [
  { id: "projects", label: "Projects", icon: <StackIcon /> },
  { id: "gtd", label: "GTD", icon: <ListBulletIcon /> },
  { id: "postit", label: "Post-its", icon: <DashboardIcon /> },
  { id: "eisenhower", label: "Eisenhower", icon: <GridIcon /> },
  { id: "kanban", label: "Kanban", icon: <ViewVerticalIcon /> },
  { id: "calendar", label: "Calendar", icon: <CalendarIcon /> },
  { id: "mindmap", label: "Mind Map", icon: <Share1Icon /> },
];

const CUSTOM_ICON_MAP: Record<string, ReactNode> = {
  list: <ListBulletIcon />,
  grid: <GridIcon />,
  columns: <ViewVerticalIcon />,
  layers: <StackIcon />,
  target: <DashboardIcon />,
  clock: <CalendarIcon />,
  star: <Share1Icon />,
};

export function MorphBar({
  activeView,
  onViewChange,
  onStudioToggle,
  studioOpen,
  customViews,
  onCreateView,
  folderName,
}: Props) {
  return (
    <Flex
      align="center"
      px="3"
      gap="1"
      style={{
        height: 44,
        flexShrink: 0,
        borderBottom: "1px solid var(--gray-a4)",
        background: "var(--color-background)",
      }}
    >
      {folderName && (
        <>
          <Text size="2" weight="bold" style={{ marginRight: 8 }}>
            {folderName}
          </Text>
          <Separator orientation="vertical" size="1" />
        </>
      )}

      {BUILT_IN_VIEWS.map((v) => (
        <Tooltip key={v.id} content={v.label}>
          <IconButton
            size="2"
            variant={activeView === v.id ? "solid" : "ghost"}
            onClick={() => onViewChange(v.id)}
          >
            {v.icon}
          </IconButton>
        </Tooltip>
      ))}

      {customViews.length > 0 && <Separator orientation="vertical" size="1" />}

      {customViews.map((v) => (
        <Tooltip key={v.id} content={v.name}>
          <IconButton
            size="2"
            variant={activeView === v.id ? "solid" : "ghost"}
            onClick={() => onViewChange(v.id)}
          >
            {CUSTOM_ICON_MAP[v.icon] ?? <DashboardIcon />}
          </IconButton>
        </Tooltip>
      ))}

      <Tooltip content="Create custom view">
        <IconButton size="1" variant="ghost" color="gray" onClick={onCreateView}>
          <PlusIcon />
        </IconButton>
      </Tooltip>

      <div style={{ flex: 1 }} />

      <Tooltip content="Studio">
        <IconButton
          size="2"
          variant={studioOpen ? "solid" : "ghost"}
          color="purple"
          onClick={onStudioToggle}
        >
          <MixerHorizontalIcon />
        </IconButton>
      </Tooltip>
    </Flex>
  );
}
