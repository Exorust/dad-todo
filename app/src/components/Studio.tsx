import { useState } from "react";
import { Box, Flex, Text, TextField, IconButton, ScrollArea } from "@radix-ui/themes";
import { Cross2Icon, PaperPlaneIcon } from "@radix-ui/react-icons";
import { invoke } from "@tauri-apps/api/core";
import type { ViewConfig } from "../types";

interface Props {
  viewName: string;
  viewConfig: ViewConfig;
  onConfigChange: (config: ViewConfig) => void;
  onClose: () => void;
}

interface Message {
  role: "user" | "assistant";
  text: string;
}

export function Studio({ viewName, viewConfig, onConfigChange, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const send = async () => {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setLoading(true);

    try {
      const result = await invoke<{ ok: boolean; configDelta: ViewConfig }>(
        "studio_chat",
        { message: text, viewName, viewConfig }
      );
      if (result.ok && result.configDelta) {
        onConfigChange(result.configDelta);
        setMessages((m) => [...m, { role: "assistant", text: "Done - updated the view." }]);
      } else {
        setMessages((m) => [...m, { role: "assistant", text: "Hmm, couldn't apply that change." }]);
      }
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: `Error: ${err}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      style={{
        width: 340,
        height: "100%",
        borderLeft: "1px solid var(--gray-a4)",
        display: "flex",
        flexDirection: "column",
        background: "var(--color-background)",
        flexShrink: 0,
      }}
    >
      <Flex
        align="center"
        justify="between"
        px="3"
        style={{ height: 44, borderBottom: "1px solid var(--gray-a4)" }}
      >
        <Text size="2" weight="bold" color="purple">Studio</Text>
        <IconButton size="1" variant="ghost" onClick={onClose}>
          <Cross2Icon />
        </IconButton>
      </Flex>

      <ScrollArea style={{ flex: 1 }}>
        <Flex direction="column" gap="2" p="3">
          {messages.length === 0 && (
            <Text size="2" color="gray">
              Tell me how to tweak this view. Try "make it more spacious" or "sort by due date".
            </Text>
          )}
          {messages.map((m, i) => (
            <Box
              key={i}
              p="2"
              style={{
                background: m.role === "user" ? "var(--accent-3)" : "var(--gray-a3)",
                borderRadius: 8,
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "85%",
              }}
            >
              <Text size="2">{m.text}</Text>
            </Box>
          ))}
          {loading && (
            <Text size="1" color="gray">Thinking...</Text>
          )}
        </Flex>
      </ScrollArea>

      <Flex gap="2" p="3" style={{ borderTop: "1px solid var(--gray-a4)" }}>
        <TextField.Root
          style={{ flex: 1 }}
          size="2"
          placeholder="Tweak this view..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <IconButton size="2" onClick={send} disabled={loading}>
          <PaperPlaneIcon />
        </IconButton>
      </Flex>
    </Box>
  );
}
