type Source = "table" | "power";

type Point = { x: number; y: number };

export interface PowerShotControls {
  beginPowerShot(): boolean;
  updateShotPower(power: number): boolean;
  releasePowerShot(): void;
  cancelPowerShot(): void;
}

/** 两种输入共用手势所有权，力度与角度仍由场景持有。 */
export function createShotInput(options: {
  enabled(): boolean;
  cue(): Point | null;
  setAngle(angle: number): void;
  power(): number;
  setPower(power: number): void;
  fire(power: number): void;
  reset(animate: boolean): void;
}) {
  let source: Source | null = null;
  let aimOnly = false;

  function cancel(owner?: Source) {
    if (source === null || (owner && owner !== source)) return;
    source = null;
    options.reset(false);
  }

  function begin(owner: Source) {
    if (source !== null || !options.enabled() || !options.cue()) return false;
    source = owner;
    options.setPower(0);
    return true;
  }

  function update(owner: Source, power: number) {
    if (source !== owner) return false;
    if (!options.enabled() || !Number.isFinite(power)) {
      cancel(owner);
      return false;
    }
    options.setPower(Math.max(0, Math.min(1, power)));
    return true;
  }

  function drag(point: Point) {
    if (source !== "table") return;
    const cue = options.cue();
    if (!options.enabled() || !cue) {
      cancel("table");
      return;
    }
    const dx = point.x - cue.x;
    const dy = point.y - cue.y;
    const distance = Math.hypot(dx, dy);
    // 与原球桌手势相同：朝手指反方向瞄准，7cm 死区、55cm 满行程。
    if (distance > 0.035) options.setAngle(Math.atan2(-dy, -dx));
    update("table", aimOnly ? 0 : (distance - 0.07) / 0.55);
  }

  function release(owner: Source) {
    if (source !== owner) return;
    if (!options.enabled()) {
      cancel(owner);
      return;
    }
    source = null;
    if (owner === "table" && aimOnly) {
      options.reset(false);
      return;
    }
    const power = options.power();
    // 先释放手势，再由场景同步锁定本杆；重复松手不能再次提交。
    if (power >= 0.05) options.fire(Math.max(0.06, power));
    else options.reset(true);
  }

  return {
    get source() {
      return source;
    },
    setAimOnly(value: boolean) {
      if (aimOnly === value) return;
      cancel();
      aimOnly = value;
    },
    beginTable(point: Point) {
      if (begin("table")) drag(point);
    },
    drag,
    releaseTable: () => release("table"),
    cancel,
    beginPowerShot: () => begin("power"),
    updateShotPower: (power: number) => update("power", power),
    releasePowerShot: () => release("power"),
    cancelPowerShot: () => cancel("power"),
  };
}
