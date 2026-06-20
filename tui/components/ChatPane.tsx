import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface ChatMessage {
  role: "user" | "ai";
  text: string;
}

interface ChatPaneProps {
  messages: ChatMessage[];
  focused: boolean;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
  scrollOffset: number;
  width: number;
}

export function ChatPane(props: ChatPaneProps) {
  const maxLines = 4;
  const historyLines: { prefix: string; prefixColor: string; text: string }[] = [];

  for (const msg of props.messages) {
    const lines = msg.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      historyLines.push({
        prefix: i === 0 ? (msg.role === "user" ? "you: " : "ai: ") : "      ",
        prefixColor: msg.role === "user" ? "gray" : "blue",
        text: lines[i]!,
      });
    }
  }

  let displayLines: typeof historyLines;
  if (historyLines.length === 0) {
    displayLines = [{
      prefix: "",
      prefixColor: "gray",
      text: "  Tab to chat with Pi  -  ?: help  -  a: add  -  u: undo  -  q,q: quit",
    }];
  } else {
    const maxOffset = Math.max(0, historyLines.length - maxLines);
    const effectiveOffset = Math.min(props.scrollOffset, maxOffset);
    const start = Math.max(0, historyLines.length - maxLines - effectiveOffset);
    displayLines = historyLines.slice(start, start + maxLines);
    if (effectiveOffset > 0 && displayLines.length > 0) {
      displayLines[0] = {
        prefix: "",
        prefixColor: "gray",
        text: `  ... ${effectiveOffset} line(s) below ...`,
      };
    }
  }

  while (displayLines.length < maxLines) {
    displayLines.push({ prefix: "", prefixColor: "gray", text: "" });
  }

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text dimColor>{"─".repeat(props.width)}</Text>
      {displayLines.map((line, i) => (
        <Box key={i}>
          <Text color={line.prefixColor}>{line.prefix ? `  ${line.prefix}` : ""}</Text>
          <Text color={line.prefixColor === "blue" ? undefined : "white"}>{line.text}</Text>
        </Box>
      ))}
      <Box>
        <Text dimColor>{"  j/k:nav  space:toggle  a:add  i:edit  /:search  Tab:chat  ?:help  q,q:quit"}</Text>
      </Box>
      <Box>
        <Text color={props.focused ? "blue" : "gray"}>  {">"} </Text>
        {props.focused ? (
          <TextInput
            value={props.inputValue}
            onChange={props.onInputChange}
            onSubmit={props.onSubmit}
          />
        ) : (
          <Text dimColor>{props.inputValue}</Text>
        )}
      </Box>
    </Box>
  );
}
