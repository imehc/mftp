import { createTonePlayer } from "../engine/tone-player";

export const chessAudio = createTonePlayer();

export function playChessMove(volume: number, finished: boolean) {
  chessAudio.play(
    finished
      ? [
          { frequency: 523, duration: 0.12 },
          { frequency: 659, duration: 0.16, delay: 0.1 },
        ]
      : [
          { frequency: 260, duration: 0.065 },
          { frequency: 145, duration: 0.05, delay: 0.025 },
        ],
    volume * 0.7,
  );
}
