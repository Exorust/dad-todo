import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { VIEWS, type ActiveViewName, type CustomView, type StatusKind, type ThemeColors } from "../types.js";

interface TabBarProps {
  activeView: ActiveViewName;
  customViews: CustomView[];
  visibleCount: number;
  totalCount: number;
  folderName: string;
  searchFilter: string;
  hideDone: boolean;
  statusMessage: string;
  statusKind: StatusKind;
  theme: ThemeColors;
  searchActive: boolean;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: (value: string) => void;
  addActive: boolean;
  addTargetFile: string;
  addValue: string;
  onAddChange: (value: string) => void;
  onAddSubmit: (value: string) => void;
  editActive: boolean;
  editValue: string;
  onEditChange: (value: string) => void;
  onEditSubmit: (value: string) => void;
  width: number;
}

export function TabBar(props: TabBarProps) {
  const compact = props.width < 100;
  const countLabel = props.visibleCount !== props.totalCount
    ? `${props.visibleCount}/${props.totalCount} tasks`
    : `${props.totalCount} tasks`;

  const statusColor = props.statusKind === "error" ? "red"
    : props.statusKind === "warning" ? "yellow"
    : props.statusKind === "success" ? "green"
    : "gray";

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box>
        <Text dimColor>{props.folderName.slice(0, compact ? 12 : 24)}</Text>
        <Text> </Text>
        {VIEWS.map(v => {
          const isActive = v.key === props.activeView;
          const label = compact ? v.num : `${v.num}:${v.label}`;
          return (
            <Text key={v.key} inverse={isActive} bold={isActive} color={isActive ? "white" : "gray"} backgroundColor={isActive ? "blue" : undefined}>
              {` ${label} `}
            </Text>
          );
        })}
        {props.customViews.map((v, i) => {
          const key: ActiveViewName = `custom:${v.name}`;
          const hotkey = i === 0 ? "9" : "0";
          const isActive = props.activeView === key;
          const label = compact ? hotkey : `${hotkey}:${v.name}`;
          return (
            <Text key={key} inverse={isActive} bold={isActive} color={isActive ? "white" : "gray"} backgroundColor={isActive ? "blue" : undefined}>
              {` ${label} `}
            </Text>
          );
        })}
        <Text dimColor> {countLabel} </Text>
        {props.searchFilter ? <Text color="yellow"> /{props.searchFilter}</Text> : null}
        {props.hideDone ? <Text dimColor> [hide done]</Text> : null}
        {props.statusMessage ? <Text color={statusColor}>  {props.statusMessage}</Text> : null}
      </Box>
      <Text dimColor>{"─".repeat(props.width)}</Text>
      {props.searchActive && (
        <Box>
          <Text color="yellow">  / search </Text>
          <TextInput value={props.searchValue} onChange={props.onSearchChange} onSubmit={props.onSearchSubmit} />
        </Box>
      )}
      {props.addActive && (
        <Box>
          <Text color="green">  + add to {props.addTargetFile}: </Text>
          <TextInput value={props.addValue} onChange={props.onAddChange} onSubmit={props.onAddSubmit} />
        </Box>
      )}
      {props.editActive && (
        <Box>
          <Text color="cyan">  edit: </Text>
          <TextInput value={props.editValue} onChange={props.onEditChange} onSubmit={props.onEditSubmit} />
        </Box>
      )}
    </Box>
  );
}
