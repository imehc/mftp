import type {
  BaseState,
  JunqiVariant,
  Knowledge,
  PieceKind,
  Side,
} from "./types";

export type ViewPiece =
  | { id: string; side: Side; face: "known"; kind: PieceKind }
  | { id: string; side: Side | null; face: "covered"; kind?: never };

export type ViewBoard = (ViewPiece | null)[];

export interface JunqiView {
  variant: JunqiVariant;
  board: ViewBoard;
  phase: BaseState["phase"];
  turnSeat: Side;
  turnSide: Side | null;
  viewerSide: Side | null;
  winner: Side | null;
  reason: BaseState["reason"];
  ply: number;
  revision: number;
  lastMove: BaseState["lastMove"];
  lastCombat: BaseState["lastCombat"];
  candidates: Knowledge;
}
