import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef } from "react";

import { snookerValue } from "../snooker-equipment";
import { useSnookerBallName } from "../SnookerBall";
import type { BallSelectionView } from "./scene-contract";

export function BallSelectionOverlay({
  view,
  onPreview,
  onSelect,
  onDismiss,
}: {
  view: BallSelectionView;
  onPreview(id: number): void;
  onSelect(id: number): void;
  onDismiss(): void;
}) {
  const { t } = useLingui();
  const name = useSnookerBallName();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (view.phase === "selecting")
      host.current
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus({ preventScroll: true });
  }, [view.phase]);
  return (
    <div
      ref={host}
      role="group"
      aria-label={t`选择目标球`}
      className="pointer-events-none absolute inset-0 z-10"
      data-ball-selection={view.phase}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onDismiss();
        }
      }}
    >
      {view.options.map((option) => {
        const points = snookerValue(option.id);
        const ballName = name(option.id);
        const size = Math.max(44, option.diameter + 4);
        return (
          <button
            key={option.id}
            data-ball-id={option.id}
            type="button"
            disabled={view.phase !== "selecting"}
            aria-label={t({
              message: `${ballName}，${points} 分`,
              comment: "球桌内选球的透明命中控件；球名仅供读屏，不显示在球桌上",
            })}
            className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full bg-transparent outline-none hover:ring-2 hover:ring-white/60 focus-visible:ring-2 focus-visible:ring-white disabled:pointer-events-none"
            style={{
              left: option.x,
              top: option.y,
              width: size,
              height: size,
              opacity: view.phase === "selecting" ? 1 : 0,
            }}
            onPointerEnter={() => onPreview(option.id)}
            onFocus={() => onPreview(option.id)}
            onClick={() => onSelect(option.id)}
          >
            <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 pt-1 text-sm font-medium whitespace-nowrap text-white tabular-nums [text-shadow:0_1px_3px_#000]">
              <Trans comment="球桌中央选球区域，球体下方仅显示实际分值">
                {points} 分
              </Trans>
            </span>
          </button>
        );
      })}
    </div>
  );
}
