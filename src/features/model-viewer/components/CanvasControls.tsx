import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowDown, ArrowUp, Move } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { isMobilePlatform } from "~/lib/platform";

import { unitFactor } from "../inspection/tools";
import type { ModelViewerRuntime } from "../runtime/viewer";

function FlightPad({ runtime }: { runtime: ModelViewerRuntime }) {
  const { t } = useLingui();
  const [stick, setStick] = useState([0, 0]);
  const pointer = useRef<number | null>(null);
  const tap = useRef<[number, number, number]>([0, 0, 0]);
  useEffect(() => {
    const clear = () => {
      pointer.current = null;
      runtime.flight.input(0, 0);
      setStick([0, 0]);
    };

    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
      runtime.flight.input(0, 0, 0);
    };
  }, [runtime]);
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="bg-background/90 focus-visible:ring-ring relative size-24 touch-none rounded-full border focus-visible:ring-2 focus-visible:outline-none"
        aria-label={t({
          message: "移动摇杆",
          comment: "拖动控制自由相机前后左右；方向键也可移动。",
        })}
        onPointerDown={(e) => {
          if (pointer.current !== null) return;
          pointer.current = e.pointerId;
          const rect = e.currentTarget.getBoundingClientRect();
          tap.current = [
            (e.clientX - rect.left - rect.width / 2) / (rect.width / 2),
            (e.clientY - rect.top - rect.height / 2) / (rect.height / 2),
            performance.now(),
          ];
          e.currentTarget.setPointerCapture(e.pointerId);
          e.preventDefault();
        }}
        onPointerMove={(e) => {
          if (pointer.current !== e.pointerId) return;
          tap.current[2] = 0;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2),
            y = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2);
          const length = Math.max(1, Math.hypot(x, y));
          setStick([x / length, y / length]);
          runtime.flight.input(x / length, -y / length);
        }}
        onPointerUp={(e) => {
          if (pointer.current !== e.pointerId) return;
          if (tap.current[2] && performance.now() - tap.current[2] < 250)
            runtime.flight.nudge(tap.current[0], -tap.current[1]);
          pointer.current = null;
          e.currentTarget.releasePointerCapture(e.pointerId);
          setStick([0, 0]);
          runtime.flight.input(0, 0);
        }}
        onPointerCancel={() => {
          pointer.current = null;
          setStick([0, 0]);
          runtime.flight.input(0, 0);
        }}
        onLostPointerCapture={() => {
          pointer.current = null;
          setStick([0, 0]);
          runtime.flight.input(0, 0);
        }}
        onKeyDown={(e) => {
          const direction: Record<string, [number, number]> = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, 1],
            ArrowDown: [0, -1],
          };
          if (direction[e.key]) {
            runtime.flight.nudge(...direction[e.key]);
            e.preventDefault();
          }
        }}
      >
        <Move
          aria-hidden="true"
          className="text-muted-foreground absolute top-1/2 left-1/2 size-6 -translate-1/2"
        />
        <span
          aria-hidden="true"
          className="bg-foreground/20 pointer-events-none absolute top-1/2 left-1/2 size-9 -translate-1/2 rounded-full"
          style={{
            marginLeft: `${stick[0] * 1.5}rem`,
            marginTop: `${stick[1] * 1.5}rem`,
          }}
        />
      </button>
      <div className="flex flex-col gap-2">
        {([1, -1] as const).map((up) => (
          <Button
            key={up}
            density="adaptive"
            variant="outline"
            size="icon"
            className="touch-none"
            aria-label={
              up === 1
                ? t({ message: "上升", comment: "自由相机沿竖直方向上升。" })
                : t({ message: "下降", comment: "自由相机沿竖直方向下降。" })
            }
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              runtime.flight.vertical(up);
            }}
            onPointerUp={() => runtime.flight.vertical(0)}
            onPointerCancel={() => runtime.flight.vertical(0)}
            onLostPointerCapture={() => runtime.flight.vertical(0)}
            onClick={(e) => {
              if (e.detail === 0) runtime.flight.nudge(0, 0, up);
            }}
          >
            {up === 1 ? (
              <ArrowUp aria-hidden="true" />
            ) : (
              <ArrowDown aria-hidden="true" />
            )}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function CanvasControls({
  runtime,
  interactive,
}: {
  runtime: ModelViewerRuntime;
  interactive: boolean;
}) {
  const { i18n } = useLingui();
  const state = useSyncExternalStore(
    runtime.tools.subscribe,
    runtime.tools.snapshot,
  );
  const [lockFailed, setLockFailed] = useState(false);
  const distance =
    state.distance === null
      ? null
      : `${new Intl.NumberFormat(i18n.locale, { maximumSignificantDigits: 6 }).format(state.distance * unitFactor[state.unit])} ${state.unit}`;
  if (state.mode === "orbit" || !interactive) return null;
  return (
    <>
      <div className="absolute top-3 right-3 left-3 flex flex-wrap items-center gap-2">
        <Button
          density="adaptive"
          variant="outline"
          onClick={() => {
            setLockFailed(false);
            runtime.setMode("orbit");
            runtime.focusCanvas();
          }}
        >
          {state.mode === "place" ? (
            <Trans comment="结束三维模型的拖动摆放。">完成摆放</Trans>
          ) : (
            <Trans comment="退出三维画布的自由移动或测量模式。">结束操作</Trans>
          )}
        </Button>
        {state.mode === "fly" && !isMobilePlatform() ? (
          <Button
            density="adaptive"
            variant="outline"
            onClick={() => {
              runtime.focusCanvas();
              void runtime.flight.lock().then((ok) => setLockFailed(!ok));
            }}
          >
            <Trans comment="请求鼠标指针锁定以连续转动第一人称视角。">
              锁定鼠标
            </Trans>
          </Button>
        ) : null}
        {state.mode === "measure" ? (
          <>
            <Button
              density="adaptive"
              variant="outline"
              onClick={() => runtime.tools.measurement.pickAt()}
            >
              <Trans comment="在三维画布中心射线与模型交点处拾取测量点。">
                选取中心点
              </Trans>
            </Button>
            <span
              role="status"
              className="bg-background/90 rounded-md px-2 py-1 text-sm"
            >
              {distance ??
                (state.points === 0 ? (
                  <Trans>选择起点</Trans>
                ) : (
                  <Trans>选择终点</Trans>
                ))}
            </span>
          </>
        ) : null}
        {lockFailed ? (
          <Alert>
            <AlertDescription>
              <Trans>无法锁定鼠标，可拖动画布转向。</Trans>
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
      {state.mode === "fly" ? (
        <div className="absolute bottom-14 left-3">
          <FlightPad runtime={runtime} />
        </div>
      ) : null}
      {state.mode === "measure" ? (
        <span
          aria-hidden="true"
          className="bg-foreground ring-background pointer-events-none absolute top-1/2 left-1/2 size-1.5 -translate-1/2 rounded-full ring-2"
        />
      ) : null}
    </>
  );
}
