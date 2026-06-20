import { useState, useEffect, useCallback } from "react";
import { Flex, Box } from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import { MorphBar } from "./components/MorphBar";
import { Studio } from "./components/Studio";
import { Welcome } from "./components/Welcome";
import { Setup } from "./components/Setup";
import { ProjectsView } from "./views/ProjectsView";
import { GtdView } from "./views/GtdView";
import { EisenhowerView } from "./views/EisenhowerView";
import { KanbanView } from "./views/KanbanView";
import { PostItView } from "./views/PostItView";
import { CalendarView } from "./views/CalendarView";
import { MindMapView } from "./views/MindMapView";
import { BucketView } from "./views/BucketView";
import { useTasks } from "./hooks/useTasks";
import { useCategorize } from "./hooks/useCategorize";
import type { ViewConfig, CustomViewDef, ViewName } from "./types";
import { DEFAULT_VIEW_CONFIG } from "./types";

const VIEWS_NEEDING_AI: Set<string> = new Set([
  "gtd", "eisenhower", "kanban", "postit", "calendar", "mindmap",
]);

function App() {
  const [setupDone, setSetupDone] = useState(false);
  const [watchedDir, setWatchedDir] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<string>("projects");
  const [studioOpen, setStudioOpen] = useState(false);
  const [viewConfigs, setViewConfigs] = useState<Record<string, ViewConfig>>({});
  const [customViews, setCustomViews] = useState<CustomViewDef[]>([]);
  const [fadeKey, setFadeKey] = useState(0);

  const { tasks, toggleTask, convertToTodo } = useTasks();
  const {
    buckets,
    loading: catLoading,
    prefetchAll,
    switchToView,
    categorizeCustom,
  } = useCategorize();

  useEffect(() => {
    invoke<string | null>("get_watched_dir").then((dir) => {
      if (dir) setWatchedDir(dir);
    });
  }, []);

  // When tasks change, prefetch all view categorizations
  useEffect(() => {
    if (tasks.length > 0) {
      prefetchAll(tasks);
      // Also refresh the active view immediately
      if (VIEWS_NEEDING_AI.has(activeView)) {
        switchToView(activeView, tasks);
      }
    }
  }, [tasks]);

  const currentConfig = viewConfigs[activeView] ?? DEFAULT_VIEW_CONFIG;

  const switchView = useCallback(
    (view: string) => {
      setFadeKey((k) => k + 1);
      setActiveView(view);

      const custom = customViews.find((v) => v.id === view);
      if (custom) {
        categorizeCustom(view, tasks, custom.categorizationPrompt);
      } else if (VIEWS_NEEDING_AI.has(view)) {
        switchToView(view, tasks);
      }
    },
    [tasks, switchToView, categorizeCustom, customViews]
  );

  const handleConfigChange = useCallback(
    (config: ViewConfig) => {
      setViewConfigs((prev) => ({ ...prev, [activeView]: config }));
    },
    [activeView]
  );

  const handleCreateView = useCallback(async () => {
    if (customViews.length >= 10) return;
    const desc = window.prompt("Describe your custom view:");
    if (!desc) return;
    try {
      const result = await invoke<{ ok: boolean; view: CustomViewDef }>(
        "create_custom_view",
        { description: desc }
      );
      if (result.ok && result.view) {
        const view: CustomViewDef = {
          ...result.view,
          id: `custom_${Date.now()}`,
        };
        setCustomViews((prev) => [...prev, view]);
        switchView(view.id);
      }
    } catch (err) {
      console.error("[dadtodo] create view failed:", err);
    }
  }, [customViews, switchView]);

  if (!setupDone) {
    return <Setup onReady={() => setSetupDone(true)} />;
  }

  if (!watchedDir) {
    return <Welcome onFolderSelected={setWatchedDir} />;
  }

  const folderName = watchedDir.split("/").pop() ?? watchedDir;

  const renderView = () => {
    const custom = customViews.find((v) => v.id === activeView);
    if (custom) {
      return (
        <BucketView
          tasks={tasks}
          buckets={buckets}
          config={currentConfig}
          onToggle={toggleTask}
          loading={catLoading}
          structureType={custom.structureType}
        />
      );
    }

    const viewProps = { tasks, config: currentConfig, onToggle: toggleTask, onConvert: convertToTodo };
    const catProps = { ...viewProps, buckets, loading: catLoading };

    switch (activeView as ViewName) {
      case "projects":
        return <ProjectsView {...viewProps} />;
      case "gtd":
        return <GtdView {...catProps} />;
      case "eisenhower":
        return <EisenhowerView {...catProps} />;
      case "kanban":
        return <KanbanView {...catProps} />;
      case "postit":
        return <PostItView {...catProps} />;
      case "calendar":
        return <CalendarView {...catProps} />;
      case "mindmap":
        return <MindMapView {...catProps} />;
      default:
        return <ProjectsView {...viewProps} />;
    }
  };

  return (
    <Flex direction="column" style={{ height: "100vh", width: "100vw" }}>
      <MorphBar
        activeView={activeView}
        onViewChange={switchView}
        onStudioToggle={() => setStudioOpen((o) => !o)}
        studioOpen={studioOpen}
        customViews={customViews}
        onCreateView={handleCreateView}
        folderName={folderName}
      />
      <Flex style={{ flex: 1, minHeight: 0 }}>
        <Box key={fadeKey} style={{ flex: 1, minWidth: 0, animation: "fadeIn 200ms ease-in" }}>
          {renderView()}
        </Box>
        {studioOpen && (
          <Studio
            viewName={activeView}
            viewConfig={currentConfig}
            onConfigChange={handleConfigChange}
            onClose={() => setStudioOpen(false)}
          />
        )}
      </Flex>
      <style>{`@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
    </Flex>
  );
}

export default App;
