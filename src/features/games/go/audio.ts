let context: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtor = window.AudioContext;
  if (!AudioCtor) return null;
  context ??= new AudioCtor();
  return context;
}

export function unlockGoAudio(): void {
  void getAudioContext()?.resume();
}

function playTone(frequency: number, duration: number, volume: number): void {
  const ctx = getAudioContext();
  if (!ctx || volume <= 0) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  osc.type = "sine";
  osc.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume * 0.18, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

export function playStoneSound(volume: number): void {
  playTone(340, 0.09, volume);
}

export function playCaptureSound(volume: number): void {
  playTone(300, 0.08, volume);
  window.setTimeout(() => playTone(240, 0.1, volume), 60);
}

export function playFinishSound(volume: number): void {
  playTone(523.25, 0.12, volume);
  window.setTimeout(() => playTone(659.25, 0.16, volume), 90);
}
