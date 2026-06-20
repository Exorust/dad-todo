import { useState, useEffect } from "react";
import { Box, Button, Flex, Heading, Text, Badge, Code, Separator } from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";

interface SetupStatus {
  configured: boolean;
  agentDir: string;
  authPath: string;
  hasAuth: boolean;
  models: string[];
}

interface Props {
  onReady: () => void;
}

export function Setup({ onReady }: Props) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      const result = await invoke<{ ok: boolean } & SetupStatus>("check_setup");
      if (result.ok) {
        setStatus(result);
        if (result.configured) {
          onReady();
          return;
        }
      }
    } catch (err) {
      setError(
        typeof err === "string" ? err : "Sidecar not ready yet. It may still be starting up."
      );
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tryCheck = async () => {
      attempts++;
      try {
        const result = await invoke<{ ok: boolean } & SetupStatus>("check_setup");
        if (result.ok) {
          setStatus(result);
          setChecking(false);
          if (result.configured) { onReady(); return; }
          return;
        }
      } catch {
        // Sidecar not ready yet
      }
      if (attempts < 10) {
        timer = setTimeout(tryCheck, 1000);
      } else {
        setChecking(false);
        setError("Sidecar failed to start. Try restarting the app.");
      }
    };
    timer = setTimeout(tryCheck, 500);
    return () => clearTimeout(timer);
  }, []);

  const openTerminal = async (command: string) => {
    try {
      const script = `tell application "Terminal"
        activate
        do script "${command.replace(/"/g, '\\"')}"
      end tell`;
      await invoke("plugin:shell|execute", {
        program: "osascript",
        args: ["-e", script],
      }).catch(() => {
        // Fallback: try opening terminal directly
        window.open(`terminal://${command}`);
      });
    } catch {
      // Show the command for manual copy
    }
  };

  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      gap="5"
      style={{ height: "100vh", background: "var(--color-background)", padding: 40 }}
    >
      <Heading size="7" weight="bold">DadTodo</Heading>
      <Text size="3" color="gray">AI Setup</Text>

      {checking && (
        <Text size="2" color="gray">Checking configuration...</Text>
      )}

      {error && (
        <Box
          p="4"
          style={{
            background: "var(--red-3)",
            borderRadius: 8,
            maxWidth: 500,
            textAlign: "center",
          }}
        >
          <Text size="2" color="red">{error}</Text>
          <Box mt="3">
            <Button size="2" variant="soft" onClick={check}>
              Retry
            </Button>
          </Box>
        </Box>
      )}

      {status && !status.configured && (
        <Flex direction="column" gap="4" style={{ maxWidth: 550 }}>
          <Box p="4" style={{ background: "var(--gray-a3)", borderRadius: 10 }}>
            <Flex direction="column" gap="3">
              <Heading size="3">Pi Agent needs to be set up</Heading>
              <Text size="2" color="gray">
                DadTodo uses Pi agent to power AI features (task categorization, the Studio,
                and custom views). You need to authenticate with at least one AI provider.
              </Text>

              <Separator size="4" />

              <Text size="2" weight="bold">Current status:</Text>
              <Flex gap="2" align="center">
                <Badge color={status.hasAuth ? "green" : "red"} size="1">
                  {status.hasAuth ? "Found" : "Missing"}
                </Badge>
                <Text size="2">Auth config at <Code size="1">{status.authPath}</Code></Text>
              </Flex>

              {status.models.length > 0 && (
                <Flex gap="2" wrap="wrap">
                  <Text size="2">Providers:</Text>
                  {status.models.map((m) => (
                    <Badge key={m} size="1" color="blue">{m}</Badge>
                  ))}
                </Flex>
              )}

              <Separator size="4" />

              <Text size="2" weight="bold">Quick setup options:</Text>

              <Flex direction="column" gap="2">
                <Button
                  size="2"
                  onClick={() => openTerminal("npx @anthropic-ai/claude-code")}
                >
                  Open terminal: Set up with Claude
                </Button>
                <Text size="1" color="gray" style={{ marginLeft: 8 }}>
                  Runs Claude Code which handles authentication automatically
                </Text>

                <Button
                  size="2"
                  variant="soft"
                  onClick={() => openTerminal("pi auth")}
                >
                  Open terminal: pi auth
                </Button>
                <Text size="1" color="gray" style={{ marginLeft: 8 }}>
                  If you have Pi installed, authenticate directly
                </Text>

                <Button
                  size="2"
                  variant="soft"
                  onClick={() => openTerminal(
                    `mkdir -p ${status.agentDir} && echo 'Add your API key to ${status.authPath}' && open ${status.agentDir}`
                  )}
                >
                  Open terminal: Manual setup
                </Button>
                <Text size="1" color="gray" style={{ marginLeft: 8 }}>
                  Opens the config directory for manual key configuration
                </Text>
              </Flex>

              <Separator size="4" />

              <Flex gap="2" justify="center">
                <Button size="2" onClick={check}>
                  Re-check setup
                </Button>
                <Button size="2" variant="soft" color="gray" onClick={onReady}>
                  Skip (no AI features)
                </Button>
              </Flex>
            </Flex>
          </Box>
        </Flex>
      )}
    </Flex>
  );
}
