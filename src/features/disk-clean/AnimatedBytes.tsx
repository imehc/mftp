import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { formatBytes } from "~/lib/format";
import { prefersReducedMotion } from "~/lib/motion";

interface AnimatedBytesProps {
  bytes: number;
}

/**
 * Byte total that tweens to its new value instead of snapping.
 *
 * Scan counters arrive in 120ms batches, so the raw number jumps in visible
 * steps. Tweening between batches reads as continuous progress.
 */
export function AnimatedBytes({ bytes }: AnimatedBytesProps) {
  const [shown, setShown] = useState(bytes);
  // Tweened through a ref-held object so each frame writes React state once,
  // rather than gsap mutating a value React doesn't know about.
  const holder = useRef({ value: bytes });

  useEffect(() => {
    const target = holder.current;
    gsap.killTweensOf(target);
    if (prefersReducedMotion()) {
      target.value = bytes;
      setShown(bytes);
      return;
    }
    gsap.to(target, {
      value: bytes,
      duration: 0.4,
      ease: "power1.out",
      onUpdate: () => setShown(target.value),
    });
    return () => {
      gsap.killTweensOf(target);
    };
  }, [bytes]);

  return <span className="tabular-nums">{formatBytes(shown)}</span>;
}
