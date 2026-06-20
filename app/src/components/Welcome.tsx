import { Box, Button, Flex, Heading, Text } from "@radix-ui/themes";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  onFolderSelected: (dir: string) => void;
}

export function Welcome({ onFolderSelected }: Props) {
  const pickFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected && typeof selected === "string") {
      await invoke("set_watched_dir", { dir: selected });
      onFolderSelected(selected);
    }
  };

  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      gap="4"
      style={{ height: "100vh", background: "var(--color-background)" }}
    >
      <Heading size="7" weight="bold">DadTodo</Heading>
      <Text size="3" color="gray">
        Your todos, seven ways.
      </Text>
      <Box mt="4">
        <Button size="3" onClick={pickFolder}>
          Pick your todo folder
        </Button>
      </Box>
      <Text size="1" color="gray" style={{ maxWidth: 300, textAlign: "center" }}>
        Choose a folder with your markdown or text files.
        DadTodo will find all your tasks and let you morph between views.
      </Text>
    </Flex>
  );
}
