interface SessionResource {
  foreground(visible: boolean): void;
  dispose(): void;
}

const resources = new Set<SessionResource>();
let foreground = true;

export function registerGameResource(resource: SessionResource): () => void {
  resources.add(resource);
  resource.foreground(foreground);
  return () => resources.delete(resource);
}

export function setGamesForeground(visible: boolean): void {
  foreground = visible;
  for (const resource of resources) resource.foreground(visible);
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
    setGamesForeground(false);
  };
}
