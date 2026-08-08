/**
 * Whether the user asked the OS to minimize animation.
 *
 * The same three-line `matchMedia` check was repeated in every animated
 * component; AGENTS.md calls for extracting on the third occurrence. Read it
 * at animation time rather than caching — the setting can change while the
 * app is open.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
