# Adversarial Review: DadTodo Ink Rewrite

## Critical Bugs - ALL FIXED

### BUG-1: Search, Add, and Edit text inputs are non-functional - FIXED

TabBar now uses `<TextInput>` from ink-text-input for all three overlays with proper onChange/onSubmit callbacks.

### BUG-2: useInput isActive is always true - FIXED

Removed the `|| true` expression. The handler returns early for chat/search/add/edit modes.

### BUG-3: Open-in-editor spawns child process without pausing Ink - FIXED

Added `process.stdin.setRawMode(false)` + `process.stdin.pause()` before spawn, restore on child exit.

### BUG-4: Stale closure in useCallback dependencies - FIXED

`persistPreferences` now accepts explicit overrides instead of reading from stale closure state.

## UX Gaps - ALL FIXED

### UX-1: Terminal resize handling - FIXED

Added `stdout.on("resize", ...)` listener that updates `termSize` state, triggering re-render with correct dimensions.

### UX-2: Visual cursor in search/add/edit overlays - FIXED

Resolved by BUG-1 fix. TextInput renders a visible cursor.

### UX-3: Tab toggles chat focus - FIXED

Tab now toggles chat focus on/off (`setChatFocused(f => !f)`). Escape also unfocuses.

### UX-4: Status messages auto-clear - FIXED

Status messages now auto-clear after 3 seconds via a setTimeout that resets the message. Timer is cleared on each new status to avoid stale clears.

### UX-5: Session state saves debounced - FIXED

Session saves are now debounced with a 500ms timer instead of firing on every state change.

### UX-6: Demo mode indicator - FIXED

Tab bar shows "DEMO" instead of the temp directory path when running in demo mode.

## Architectural Gaps - ALL FIXED

### ARCH-1: Circular reference between updateLine and writeFileWithUndo - FIXED

`writeFileWithUndo` and `undoLast` now call `refreshFileRef.current` instead of directly referencing `refreshFile`. The ref is always current, breaking the fragile empty-deps chain.

### ARCH-2: Dual state tracking (useState + ref)

Intentional pattern. The refs give callbacks access to current values without recreating them. The `refreshFileRef` pattern (ARCH-1 fix) makes this explicit and safe.

### ARCH-3: Missing barrel export

Not an issue. `bin/dadtodo.mjs` calls `tui.ts`, which imports `DadTodoApp.tsx`. No external code imports `app.ts`.

### ARCH-4: Error boundary - FIXED

Added `ErrorBoundary` class component wrapping `AppInner`. Render errors show a red message instead of crashing.

### ARCH-5: File watcher captures stale refreshFile - FIXED

Watcher callback now calls `refreshFileRef.current(filePath)` instead of the initial `refreshFile` closure.

## Test Coverage

121 tests across 5 files:
- `app.test.ts` - 8 tests (fallback categorizer via taskHelpers import)
- `parser.test.ts` - 17 tests (unchanged, framework-agnostic)
- `chat.test.ts` - 11 tests (file I/O side effects)
- `taskHelpers.test.ts` - 42 tests (categorizer, resolveDate, getVisibleTasks, hashTasks, filterBucketIndices)
- `chatCommands.test.ts` - 43 tests (all 20+ chat commands, edge cases, AI fallback)
