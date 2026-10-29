import type { BilliardsPresentation, BilliardsState } from "../types";
import type { PowerShotControls } from "./shot-input";

export interface BilliardsScene extends PowerShotControls {
  setSelection(request: BallSelectionRequest | null): void;
  previewSelection(ballId: number): void;
  selectBall(ballId: number): void;
  cancelInput(): void;
  setPosition(state: BilliardsState, interactive: boolean): void;
  setFollowDraw(followDraw: number): void;
  playPresentation(presentation: BilliardsPresentation): Promise<void>;
  animateCue(angle: number, power: number, ai: boolean): Promise<void>;
  destroy(): void;
}

export interface AimTarget {
  ballId: number;
  x: number;
  y: number;
}

export interface BallSelectionRequest {
  ids: readonly number[];
  selectedId: number | null;
}

export interface BallSelectionView {
  phase: "entering" | "selecting" | "returning";
  options: { id: number; x: number; y: number; diameter: number }[];
}

export interface SceneCallbacks {
  onSelectionView?(view: BallSelectionView | null): void;
  onSelectedBall?(ballId: number): void;
  onDismissSelection?(): void;
  onAimTarget?(target: AimTarget | null): void;
  onPowerPreview(power: number): void;
  onShot(angle: number, power: number): boolean;
  onPlaceCue(x: number, y: number): void;
  onReady(): void;
  onError(error: unknown): void;
}
