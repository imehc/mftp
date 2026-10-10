import { createTonePlayer } from "../engine/tone-player";

export const gomokuAudio = createTonePlayer();

export function unlockGomokuAudio(): void {
  gomokuAudio.unlock();
}

export function playStoneSound(volume: number): void {
  gomokuAudio.play([{ frequency: 380, duration: 0.09 }], volume);
}

export function playFinishSound(volume: number): void {
  gomokuAudio.play(
    [
      { frequency: 523.25, duration: 0.12 },
      { frequency: 659.25, duration: 0.16, delay: 0.09 },
    ],
    volume,
  );
}
