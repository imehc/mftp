import { useEffect, useMemo, useRef } from "react";
import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import { gsap } from "gsap";
import { formatBytes } from "~/lib/format";
import { prefersReducedMotion } from "~/lib/motion";
import type { TreeNode } from "~/types";

/** Fixed aspect the tiles are laid out in; the SVG scales to its box. */
const VIEW_W = 100;
const VIEW_H = 62;

/** Below this share of the parent a tile is too small to carry a label. */
const LABEL_MIN_AREA = 0.035;

interface SizeTreemapProps {
  node: TreeNode;
  onDrill: (child: TreeNode) => void;
}

/**
 * Squarified treemap of one directory level.
 *
 * Layout comes from `d3-hierarchy` rather than hand-rolled slicing — the
 * squarify algorithm keeps tiles near square, which is what makes relative
 * sizes readable at a glance.
 */
export function SizeTreemap({ node, onDrill }: SizeTreemapProps) {
  const groupRef = useRef<SVGGElement>(null);

  const tiles = useMemo(() => {
    const children = node.children.filter((child) => child.bytes > 0);
    if (children.length === 0) return [];

    // One level only: d3 needs a root, but drilling replaces the whole
    // layout rather than nesting, so children are leaves here.
    const root = hierarchy<TreeNode>({ ...node, children }, (datum) =>
      datum.path === node.path ? children : [],
    ).sum((datum) => (datum.path === node.path ? 0 : datum.bytes));

    // `treemap()(root)` returns the same node re-typed with x0/y0/x1/y1;
    // the untyped `root` above has no coordinates.
    const laid = treemap<TreeNode>()
      .tile(treemapSquarify)
      .size([VIEW_W, VIEW_H])
      .paddingInner(0.4)(root);

    return (laid.children ?? []).map((leaf) => ({
      data: leaf.data,
      x: leaf.x0,
      y: leaf.y0,
      w: Math.max(0, leaf.x1 - leaf.x0),
      h: Math.max(0, leaf.y1 - leaf.y0),
    }));
  }, [node]);

  // Re-entry animation on each drill level. Mirrors the reduce-motion guard
  // used with gsap elsewhere (TransferPanel.tsx:152).
  useEffect(() => {
    const group = groupRef.current;
    if (!group || group.children.length === 0) return;

    const reduceMotion = prefersReducedMotion();

    gsap.killTweensOf(group.children);
    if (reduceMotion) {
      gsap.set(group.children, { opacity: 1, clearProps: "transform" });
      return;
    }

    gsap.fromTo(
      group.children,
      { opacity: 0, scale: 0.94, transformOrigin: "50% 50%" },
      {
        opacity: 1,
        scale: 1,
        duration: 0.28,
        ease: "power2.out",
        stagger: 0.012,
        clearProps: "transform",
      },
    );

    return () => {
      gsap.killTweensOf(group.children);
    };
    // Keyed on the drilled path: each level replays the entrance.
  }, [node.path, tiles]);

  if (tiles.length === 0) {
    return null;
  }

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="h-full w-full"
      role="img"
    >
      <g ref={groupRef}>
        {tiles.map((tile) => {
          const share = (tile.w * tile.h) / (VIEW_W * VIEW_H);
          const label = share >= LABEL_MIN_AREA;
          return (
            <g
              key={tile.data.path}
              className={
                tile.data.isDir ? "cursor-pointer" : "cursor-default"
              }
              onClick={() => tile.data.isDir && onDrill(tile.data)}
            >
              <title>{`${tile.data.path} — ${formatBytes(tile.data.bytes)}`}</title>
              <rect
                x={tile.x}
                y={tile.y}
                width={tile.w}
                height={tile.h}
                rx={0.6}
                className={
                  tile.data.isDir
                    ? "fill-primary/25 stroke-primary/40 hover:fill-primary/40"
                    : "fill-muted stroke-border"
                }
                strokeWidth={0.15}
              />
              {label ? (
                <text
                  x={tile.x + 0.8}
                  y={tile.y + 2.2}
                  className="pointer-events-none fill-foreground"
                  style={{ fontSize: 1.6 }}
                >
                  {tile.data.name}
                </text>
              ) : null}
              {label ? (
                <text
                  x={tile.x + 0.8}
                  y={tile.y + 4.2}
                  className="pointer-events-none fill-muted-foreground"
                  style={{ fontSize: 1.3 }}
                >
                  {formatBytes(tile.data.bytes)}
                </text>
              ) : null}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
