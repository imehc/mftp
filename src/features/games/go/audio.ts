import { createTonePlayer } from "../engine/tone-player";

export const goAudio = createTonePlayer();

export function unlockGoAudio(): void {
  goAudio.unlock();
}

export function playStoneSound(volume: number): void {
  goAudio.play([{ frequency: 340, duration: 0.09 }], volume);
}

export function playFinishSound(volume: number): void {
  goAudio.play(
    [
      { frequency: 523.25, duration: 0.12 },
      { frequency: 659.25, duration: 0.16, delay: 0.09 },
    ],
    volume,
  );
}

export function playCaptureSound(volume: number): void {
  goAudio.play(
    [
      { frequency: 300, duration: 0.08 },
      { frequency: 240, duration: 0.1, delay: 0.06 },
    ],
    volume,
  );
}
