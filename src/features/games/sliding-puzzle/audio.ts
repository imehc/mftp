import { createGameAudioResources } from "../engine/game-audio-resources";

export function createPuzzleAudio() {
  const resources = createGameAudioResources();
  return {
    ...resources,
    play(volume: number) {
      const context = resources.getContext();
      if (!context || volume <= 0) return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(440, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(
        190,
        context.currentTime + 0.045,
      );
      gain.gain.setValueAtTime(volume * 0.12, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        context.currentTime + 0.055,
      );
      oscillator.connect(gain).connect(context.destination);
      resources.track(oscillator, gain);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.06);
    },
  };
}
