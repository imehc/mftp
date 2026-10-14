import { useEffect } from "react";

import { useSettingsStore } from "~/store/settings";

export function useGameAudio(player: {
  stop: () => void;
  dispose: () => void;
}): void {
  const volume = useSettingsStore((state) => state.gamesVolume);

  useEffect(() => () => player.dispose(), [player]);
  useEffect(() => {
    const stopHidden = () => {
      if (document.hidden) player.stop();
    };

    document.addEventListener("visibilitychange", stopHidden);
    return () => document.removeEventListener("visibilitychange", stopHidden);
  }, [player]);
  useEffect(() => {
    if (volume <= 0) player.stop();
  }, [player, volume]);
}
