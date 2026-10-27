import type { HistoryLocation, RouterHistory } from "@tanstack/react-router";

const trackers = new WeakMap<
  RouterHistory,
  () => HistoryLocation | undefined
>();

export function previousAppLocation(history: RouterHistory) {
  return trackers.get(history)?.();
}

/** 只记录亲自观察到的应用历史；一级目的地是新的返回边界。 */
export function trackBackHistory(
  history: RouterHistory,
  isPrimary: (location: HistoryLocation) => boolean,
) {
  const entries = new Map<number, HistoryLocation>();
  let floor = history.location.state.__TSR_index;

  function record(location: HistoryLocation) {
    const index = location.state.__TSR_index;
    entries.set(index, location);
    if (isPrimary(location)) floor = index;
    for (const key of entries.keys()) {
      if (key < floor || key > index || key < index - 64) entries.delete(key);
    }
  }

  record(history.location);
  const dispose = history.subscribe(({ location }) => record(location));

  const previous = () => {
    const index = history.location.state.__TSR_index;
    return index > floor ? entries.get(index - 1) : undefined;
  };

  trackers.set(history, previous);
  return {
    previous,
    dispose() {
      dispose();
      if (trackers.get(history) === previous) trackers.delete(history);
    },
  };
}
