import { createGameAudioResources } from "../engine/game-audio-resources";

export const junqiAudio = createGameAudioResources();

export function playJunqiMove(volume: number, capture: boolean) {
  const context = junqiAudio.getContext();
  if (!context || volume <= 0) return;
  const length = Math.ceil(context.sampleRate * 0.075);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < length; index++)
    samples[index] = (Math.random() * 2 - 1) * Math.exp((-index / length) * 9);
  const source = context.createBufferSource(),
    filter = context.createBiquadFilter(),
    gain = context.createGain();
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = capture ? 740 : 1020;
  filter.Q.value = 2.6;
  gain.gain.value = volume * 0.4;
  source.connect(filter).connect(gain).connect(context.destination);
  source.start();
  junqiAudio.track(source, filter, gain);
}
