import { useEffect } from "react";

const FALLBACK_PRIMARY = "#d84b3e";
const COLORS = [
  "#f3bd3f",
  "#e84f63",
  "#40b9c6",
  "#f4f0df",
  "#8d6ad8",
  "#66c96f",
  "#ef7d32",
];

type ParticleKind = "paper" | "dot" | "streamer" | "spark";

type Particle = {
  age: number;
  color: string;
  delay: number;
  drag: number;
  flip: number;
  flipSpeed: number;
  gravity: number;
  height: number;
  kind: ParticleKind;
  life: number;
  rotation: number;
  spin: number;
  vx: number;
  vy: number;
  width: number;
  wobble: number;
  wobbleSpeed: number;
  x: number;
  y: number;
};

let activeCelebrationCanvas: HTMLCanvasElement | null = null;

function seededValue(seed: number): number {
  const value = Math.sin(seed * 9283.31 + 17.17) * 43758.5453;
  return value - Math.floor(value);
}

function valueBetween(seed: number, min: number, max: number): number {
  return min + seededValue(seed) * (max - min);
}

function particleColor(index: number, primary: string): string {
  return index % 7 === 0 ? primary : COLORS[index % COLORS.length];
}

function createSideBurst(
  index: number,
  width: number,
  height: number,
  primary: string,
): Particle {
  const fromLeft = index % 2 === 0;
  const kind = (["paper", "dot", "streamer", "paper"] as ParticleKind[])[
    index % 4
  ];
  return {
    age: 0,
    color: particleColor(index, primary),
    delay: valueBetween(index + 2, 0, 0.55),
    drag: valueBetween(index + 3, 0.975, 0.991),
    flip: valueBetween(index + 4, 0, Math.PI * 2),
    flipSpeed: valueBetween(index + 5, 7, 15),
    gravity: valueBetween(index + 6, 480, 680),
    height: kind === "streamer" ? valueBetween(index + 7, 23, 38) : valueBetween(index + 7, 7, 15),
    kind,
    life: valueBetween(index + 8, 3.8, 5.2),
    rotation: valueBetween(index + 9, 0, Math.PI * 2),
    spin: valueBetween(index + 10, -9, 9),
    vx: (fromLeft ? 1 : -1) * valueBetween(index + 11, width * 0.2, width * 0.58),
    vy: -valueBetween(index + 12, height * 0.72, height * 1.18),
    width: kind === "streamer" ? valueBetween(index + 13, 3, 5) : valueBetween(index + 13, 6, 13),
    wobble: valueBetween(index + 14, 0, Math.PI * 2),
    wobbleSpeed: valueBetween(index + 15, 5, 10),
    x: fromLeft ? width * 0.04 : width * 0.96,
    y: height * valueBetween(index + 16, 0.7, 0.79),
  };
}

function createCenterBurst(
  index: number,
  width: number,
  height: number,
  primary: string,
): Particle {
  const angle = valueBetween(index + 101, Math.PI * 1.08, Math.PI * 1.92);
  const speed = valueBetween(index + 102, 180, 470);
  return {
    age: 0,
    color: particleColor(index + 3, primary),
    delay: valueBetween(index + 103, 0.38, 0.88),
    drag: 0.985,
    flip: 0,
    flipSpeed: valueBetween(index + 104, 8, 14),
    gravity: valueBetween(index + 105, 170, 290),
    height: valueBetween(index + 106, 3, 7),
    kind: index % 4 === 0 ? "dot" : "spark",
    life: valueBetween(index + 107, 2.2, 3.3),
    rotation: angle,
    spin: valueBetween(index + 108, -5, 5),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    width: valueBetween(index + 109, 3, 7),
    wobble: valueBetween(index + 110, 0, Math.PI * 2),
    wobbleSpeed: valueBetween(index + 111, 4, 8),
    x: width * valueBetween(index + 112, 0.43, 0.57),
    y: height * valueBetween(index + 113, 0.34, 0.48),
  };
}

function createTopShower(
  index: number,
  width: number,
  primary: string,
): Particle {
  const kind = (["paper", "streamer", "paper", "dot"] as ParticleKind[])[
    index % 4
  ];
  return {
    age: 0,
    color: particleColor(index + 5, primary),
    delay: valueBetween(index + 202, 0.9, 1.9),
    drag: valueBetween(index + 203, 0.984, 0.994),
    flip: valueBetween(index + 204, 0, Math.PI * 2),
    flipSpeed: valueBetween(index + 205, 6, 13),
    gravity: valueBetween(index + 206, 115, 210),
    height: kind === "streamer" ? valueBetween(index + 207, 22, 36) : valueBetween(index + 207, 7, 15),
    kind,
    life: valueBetween(index + 208, 3.7, 5.1),
    rotation: valueBetween(index + 209, 0, Math.PI * 2),
    spin: valueBetween(index + 210, -6, 6),
    vx: valueBetween(index + 211, -75, 75),
    vy: valueBetween(index + 212, 45, 135),
    width: kind === "streamer" ? valueBetween(index + 213, 3, 5) : valueBetween(index + 213, 6, 13),
    wobble: valueBetween(index + 214, 0, Math.PI * 2),
    wobbleSpeed: valueBetween(index + 215, 4, 9),
    x: valueBetween(index + 216, width * 0.04, width * 0.96),
    y: -valueBetween(index + 217, 10, 70),
  };
}

function createParticles(
  width: number,
  height: number,
  primary: string,
): Particle[] {
  return [
    ...Array.from({ length: 118 }, (_, index) =>
      createSideBurst(index, width, height, primary),
    ),
    ...Array.from({ length: 42 }, (_, index) =>
      createCenterBurst(index, width, height, primary),
    ),
    ...Array.from({ length: 58 }, (_, index) =>
      createTopShower(index, width, primary),
    ),
  ];
}

function drawParticle(
  context: CanvasRenderingContext2D,
  particle: Particle,
): void {
  const progress = particle.age / particle.life;
  const fade = progress < 0.08 ? progress / 0.08 : Math.min(1, (1 - progress) / 0.22);
  const flipScale = Math.max(0.18, Math.abs(Math.cos(particle.flip)));

  context.save();
  context.globalAlpha = Math.max(0, fade);
  context.translate(particle.x, particle.y);
  context.rotate(particle.rotation);
  context.fillStyle = particle.color;
  context.strokeStyle = particle.color;

  if (particle.kind === "dot") {
    context.beginPath();
    context.arc(0, 0, particle.width * 0.55, 0, Math.PI * 2);
    context.fill();
  } else if (particle.kind === "spark") {
    context.lineCap = "round";
    context.lineWidth = particle.width * 0.55;
    context.beginPath();
    context.moveTo(-particle.height * 1.8, 0);
    context.lineTo(particle.height * 1.8, 0);
    context.stroke();
  } else if (particle.kind === "streamer") {
    context.lineCap = "round";
    context.lineWidth = particle.width;
    context.beginPath();
    context.moveTo(0, -particle.height * 0.55);
    context.bezierCurveTo(
      Math.sin(particle.wobble) * 11,
      -particle.height * 0.18,
      -Math.cos(particle.wobble) * 11,
      particle.height * 0.2,
      0,
      particle.height * 0.55,
    );
    context.stroke();
  } else {
    context.scale(flipScale, 1);
    context.fillRect(
      -particle.width * 0.5,
      -particle.height * 0.5,
      particle.width,
      particle.height,
    );
  }

  context.restore();
}

function launchVictoryConfetti(): void {
  if (
    activeCelebrationCanvas?.isConnected ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.zIndex = "50";
  canvas.style.pointerEvents = "none";
  document.body.append(canvas);
  activeCelebrationCanvas = canvas;

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    canvas.remove();
    activeCelebrationCanvas = null;
    return;
  }

  let width = window.innerWidth;
  let height = window.innerHeight;
  let frameId = 0;
  let previousTime = performance.now();
  let particles: Particle[] = [];

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const finish = () => {
    cancelAnimationFrame(frameId);
    window.removeEventListener("resize", resize);
    canvas.remove();
    if (activeCelebrationCanvas === canvas) {
      activeCelebrationCanvas = null;
    }
  };

  resize();
  const primary =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--primary")
      .trim() || FALLBACK_PRIMARY;
  particles = createParticles(width, height, primary);

  const render = (time: number) => {
    const delta = Math.min((time - previousTime) / 1000, 0.032);
    previousTime = time;
    context.clearRect(0, 0, width, height);
    let activeParticles = 0;

    for (const particle of particles) {
      particle.age += delta;
      if (particle.age < particle.delay) {
        activeParticles += 1;
        continue;
      }
      const activeAge = particle.age - particle.delay;
      if (activeAge >= particle.life) continue;

      activeParticles += 1;
      particle.vx *= particle.drag;
      particle.vy += particle.gravity * delta;
      particle.x += (particle.vx + Math.sin(particle.wobble) * 34) * delta;
      particle.y += particle.vy * delta;
      particle.rotation += particle.spin * delta;
      particle.flip += particle.flipSpeed * delta;
      particle.wobble += particle.wobbleSpeed * delta;
      const originalAge = particle.age;
      particle.age = activeAge;
      drawParticle(context, particle);
      particle.age = originalAge;
    }

    if (activeParticles > 0) {
      frameId = requestAnimationFrame(render);
    } else {
      finish();
    }
  };

  window.addEventListener("resize", resize);
  frameId = requestAnimationFrame(render);
}

export function VictoryConfetti() {
  useEffect(() => {
    // The celebration owns its lifecycle so route and game-state changes cannot interrupt it.
    launchVictoryConfetti();
  }, []);

  return null;
}
