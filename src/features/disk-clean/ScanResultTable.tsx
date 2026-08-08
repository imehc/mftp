import { useEffect, useMemo, useRef } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { gsap } from "gsap";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { formatBytes } from "~/lib/format";
import { prefersReducedMotion } from "~/lib/motion";
import * as ipc from "~/lib/ipc";
import { ruleLabel } from "./rulesMeta";
import { useDiskCleanStore } from "./store";

const ROW_HEIGHT = 40;

/**
 * Scan results, largest first. Virtualized because a full scan can return
 * thousands of paths (AGENTS.md: long lists must not render in full).
 *
 * `deletableRuleIds` comes from the catalog rather than the item: `manual`
 * rules are scanned for their size but the backend's remove gate rejects
 * their paths, so offering a checkbox would promise something that fails.
 */
export function ScanResultTable() {
  const { t } = useLingui();
  const items = useDiskCleanStore((s) => s.items);
  const rules = useDiskCleanStore((s) => s.rules);
  const selectedPaths = useDiskCleanStore((s) => s.selectedPaths);
  const togglePath = useDiskCleanStore((s) => s.togglePath);
  const scrollRef = useRef<HTMLDivElement>(null);

  const deletableRuleIds = useMemo(
    () =>
      new Set(
        rules.filter((rule) => rule.tier !== "manual").map((rule) => rule.id),
      ),
    [rules],
  );

  const expensiveRuleIds = useMemo(
    () =>
      new Set(
        rules
          .filter((rule) => rule.rebuildCost === "expensive")
          .map((rule) => rule.id),
      ),
    [rules],
  );

  const sorted = useMemo(
    () => [...items].sort((a, b) => b.bytes - a.bytes),
    [items],
  );

  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const reveal = async (path: string) => {
    try {
      await ipc.diskCleanReveal(path);
    } catch (e) {
      toast.error(String(e));
    }
  };

  // Fade the whole list in when a scan lands.
  //
  // Deliberately not per-row: the virtualizer owns each row's `transform` to
  // position it, so tweening row transforms fights it and makes rows jump.
  // Results also arrive as one batch, not streamed, so there is no stagger to
  // express anyway.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || sorted.length === 0) return;
    gsap.killTweensOf(container);
    if (prefersReducedMotion()) {
      gsap.set(container, { opacity: 1, clearProps: "transform" });
      return;
    }
    gsap.fromTo(
      container,
      { opacity: 0, y: 6 },
      { opacity: 1, y: 0, duration: 0.25, ease: "power2.out", clearProps: "transform" },
    );
    return () => {
      gsap.killTweensOf(container);
    };
    // Keyed on the batch identity, so a fresh scan replays the fade but
    // ticking a checkbox (which re-renders) does not.
  }, [items]);

  if (sorted.length === 0) return null;

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card"
    >
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = sorted[virtualRow.index];
          if (!item) return null;
          const checked = selectedPaths.has(item.path);
          const deletable =
            item.ruleId !== null && deletableRuleIds.has(item.ruleId);
          return (
            <div
              key={item.path}
              className="absolute top-0 left-0 flex w-full items-center gap-2 px-2.5 text-sm hover:bg-muted/50"
              style={{
                height: `${ROW_HEIGHT}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <Checkbox
                checked={checked}
                disabled={!deletable}
                aria-label={item.path}
                onCheckedChange={() => togglePath(item.path)}
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate" title={item.path}>
                  {item.path}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {item.ruleId ? ruleLabel(item.ruleId) : null}
                </span>
              </div>
              {item.ruleId && expensiveRuleIds.has(item.ruleId) ? (
                <Badge variant="secondary">
                  <Trans>重建慢</Trans>
                </Badge>
              ) : null}
              <span className="w-20 shrink-0 text-right tabular-nums">
                {formatBytes(item.bytes)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t`在 Finder 中显示`}
                title={t`在 Finder 中显示`}
                onClick={() => void reveal(item.path)}
              >
                <FolderOpen />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
