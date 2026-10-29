import { useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import { type PointerEvent, useEffect, useEffectEvent, useRef } from "react";

import { Slider } from "~/components/ui/slider";
import { TOUCH_TARGET_CLASS } from "~/lib/touch";

import { unlockAudio } from "./render/audio";
import type { PowerShotControls } from "./render/shot-input";

type Gesture = {
  pointerId: number | null;
  target?: Element;
  x: number;
  y: number;
  moved: boolean;
};

export function BilliardsPowerControl({
  power,
  enabled,
  vertical,
  input,
  turn,
}: {
  power: number;
  enabled: boolean;
  vertical: boolean;
  input: PowerShotControls;
  turn: number;
}) {
  const { t } = useLingui();
  const gesture = useRef<Gesture | null>(null);

  function finish(fire = false) {
    const current = gesture.current;
    if (!current) return;
    gesture.current = null;
    if (fire && enabled) input.releasePowerShot();
    else input.cancelPowerShot();
    if (
      current.pointerId !== null &&
      current.target?.hasPointerCapture(current.pointerId)
    )
      current.target.releasePointerCapture(current.pointerId);
  }

  const cancel = useEffectEvent(() => finish());
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) cancel();
    };

    const blur = () => cancel();

    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && gesture.current) {
        event.preventDefault();
        cancel();
      }
    };

    window.addEventListener("blur", blur);
    window.addEventListener("keydown", escape);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancel();
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", escape);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [enabled, vertical, turn]);

  function updatePointer(event: PointerEvent<HTMLSpanElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const size = vertical ? rect.height : rect.width;
    if (!enabled || size <= 0) {
      finish();
      return;
    }
    // 容忍按下时的微小抖动，点按轨道不会立即出杆。
    if (
      Math.abs(
        vertical ? event.clientY - current.y : event.clientX - current.x,
      ) >= 4
    )
      current.moved = true;
    const value = vertical
      ? (rect.bottom - event.clientY) / size
      : (event.clientX - rect.left) / size;
    if (!input.updateShotPower(value)) finish();
  }

  function pointerEnd(event: PointerEvent<HTMLSpanElement>, fire: boolean) {
    event.preventDefault();
    if (gesture.current?.pointerId !== event.pointerId) return;
    if (fire) updatePointer(event);
    finish(fire && gesture.current?.moved);
  }

  return (
    <Slider
      aria-label={t({
        message: "力度",
        comment: "台球击球力度滑块，拖动蓄力后松手击球",
      })}
      aria-description={t`拖动力度条，松手击球。方向键调整力度，回车或空格击球，Esc 取消。`}
      aria-valuetext={`${power}%`}
      className={cn(
        "billiards-power-slider min-w-0 flex-1",
        TOUCH_TARGET_CLASS,
      )}
      orientation={vertical ? "vertical" : "horizontal"}
      value={[power]}
      min={0}
      max={100}
      step={1}
      disabled={!enabled}
      onBlur={() => finish()}
      onPointerDown={(event) => {
        // 出杆需要自己的点按/拖动/取消语义，Slider 继续提供键盘与可访问性。
        event.preventDefault();
        if (
          !enabled ||
          event.button !== 0 ||
          gesture.current?.pointerId != null
        ) {
          return;
        }
        finish();
        if (!input.beginPowerShot()) {
          return;
        }
        unlockAudio();
        gesture.current = {
          pointerId: event.pointerId,
          target: event.currentTarget,
          x: event.clientX,
          y: event.clientY,
          moved: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget
          .querySelector<HTMLElement>('[role="slider"]')
          ?.focus({ preventScroll: true });
        updatePointer(event);
      }}
      onPointerMove={(event) => {
        event.preventDefault();
        updatePointer(event);
      }}
      onPointerUp={(event) => pointerEnd(event, true)}
      onPointerCancel={(event) => pointerEnd(event, false)}
      onLostPointerCapture={(event) => pointerEnd(event, false)}
      onValueChange={([value]) => {
        if (gesture.current && !input.updateShotPower(value / 100)) finish();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish();
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!event.repeat && gesture.current?.pointerId === null)
            finish(true);
          return;
        }
        if (
          ![
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "Home",
            "End",
            "PageUp",
            "PageDown",
          ].includes(event.key)
        )
          return;
        if (!enabled || gesture.current?.pointerId != null) {
          event.preventDefault();
          return;
        }
        if (!gesture.current) {
          if (!input.beginPowerShot()) {
            event.preventDefault();
            return;
          }
          unlockAudio();
          gesture.current = { pointerId: null, x: 0, y: 0, moved: false };
        }
      }}
    />
  );
}
