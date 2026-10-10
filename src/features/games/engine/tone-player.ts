import { createGameAudioResources } from "./game-audio-resources";

export interface Tone {
  frequency: number;
  duration: number;
  delay?: number;
}

export function createTonePlayer() {
  const audio = createGameAudioResources();

  function play(tones: readonly Tone[], volume: number): void {
    const ctx = audio.getContext();
    if (!ctx || ctx.state === "closed" || volume <= 0) return;
    const now = ctx.currentTime;
    for (const { frequency, duration, delay = 0 } of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + delay;
      osc.type = "sine";
      osc.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume * 0.18, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      osc.connect(gain).connect(ctx.destination);

      osc.start(start);
      osc.stop(start + duration + 0.02);
      audio.track(osc, gain);
    }
  }

  return {
    unlock: audio.unlock,
    play,
    stop: audio.stop,
    dispose: audio.dispose,
  };
}
