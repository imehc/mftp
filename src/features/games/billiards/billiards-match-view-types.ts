import type { MatchSnapshot } from "../engine/match";
import type { BilliardsStageHandle } from "./render/BilliardsStage";
import type { BilliardsPanel } from "./rule-panel-state";
import type { BilliardsMode, BilliardsMove, BilliardsState } from "./types";

/**
 * 对局页三个视图（比分条、球桌区、底部动作区）共享的只读输入。
 * 由 `MatchView` 唯一持有；`state` 必须与 `snapshot.state` 是同一引用，
 * 球桌区要拿它和 `runner.getSnapshot().state` 比较「渲染所用的状态是否仍然当前」。
 */
export interface BilliardsMatchContext {
  mode: BilliardsMode;
  snapshot: MatchSnapshot<BilliardsState>;
  /** `snapshot.state` 的直取别名，便于按 variant 收窄。 */
  state: BilliardsState;
  panel: BilliardsPanel;
  /** 本地玩家此刻可以出手，已扣除待处理的规则选择。 */
  canInteract: boolean;
  activeIsLocal: boolean;
  /** 斯诺克进攻方尚未提名彩球：底部控件与击球都要让位。 */
  nominationPending: boolean;
  onPanel(panel: BilliardsPanel): void;
  /** 提交走子；被规则拒绝时返回 false，调用方据此决定是否关面板。 */
  onMove(move: BilliardsMove): boolean;
}

/** 球桌命令句柄，与 `BilliardsMatch` 里 `useRef` 的结果同形。 */
export interface BilliardsStageRef {
  current: BilliardsStageHandle | null;
}
