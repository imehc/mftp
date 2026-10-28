import { createGameAudioResources } from "../engine/game-audio-resources";

export function createCubeAudio() {
  const audio = createGameAudioResources();
  let buffer: AudioBuffer | null = null;
  return {
    unlock: audio.unlock,
    stop: audio.stop,
    dispose() {
      buffer = null;
      audio.dispose();
    },
    play(volume: number) {
      const context = audio.getContext();
      if (!context || volume <= 0) return;
      buffer ??= context.createBuffer(
        1,
        Math.ceil(context.sampleRate * 0.055),
        context.sampleRate,
      );
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++)
        samples[i] =
          (Math.random() * 2 - 1) * Math.exp(-i / (samples.length * 0.2));
      const source = context.createBufferSource();
      source.buffer = buffer;
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1600;
      filter.Q.value = 0.7;
      const gain = context.createGain();
      gain.gain.value = volume * 0.3;
      source.connect(filter).connect(gain).connect(context.destination);
      audio.track(source, filter, gain);
      source.start();
    },
  };
}
