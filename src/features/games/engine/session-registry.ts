import type { TaskInterruptionSource } from "~/lib/task-interruption";

interface SessionResource {
  foreground(visible: boolean, source?: TaskInterruptionSource): void;
  dispose(): void;
}

const resources = new Set<SessionResource>();
let foreground = true;
let foregroundSource: TaskInterruptionSource = "appHidden";

export function registerGameResource(resource: SessionResource): () => void {
  resources.add(resource);
  resource.foreground(foreground, foregroundSource);
  return () => resources.delete(resource);
}

export function setGamesForeground(
  visible: boolean,
  source: TaskInterruptionSource = "appHidden",
): void {
  foreground = visible;
  foregroundSource = source;
  for (const resource of resources) resource.foreground(visible, source);
}

export function areGamesForeground(): boolean {
  return foreground;
}

export function disposeGameResources(): void {
  for (const resource of resources) resource.dispose();
}

export function installGameSessionRuntime(): () => void {
  const update = () => setGamesForeground(!document.hidden);
  document.addEventListener("visibilitychange", update);
  update();
  return () => {
    document.removeEventListener("visibilitychange", update);
    setGamesForeground(false, "runtimeDisposed");
  };
}
