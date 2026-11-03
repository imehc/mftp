import {
  commands,
  type GamePartyCreateInput,
  type GamePartyEnvelope,
  type GamePartyJoinInput,
} from "~/bindings";
import { unwrapCommand, voidCommand } from "~/lib/ipc-result";

export {
  nextPartyGeneration,
  nextPartySequence,
  queuePartyOperation,
  releasePartyRuntime,
} from "./game-party-runtime";

export const gamePartyStatus = () => unwrapCommand(commands.gamePartyStatus());
export const gamePartyCreate = (input: GamePartyCreateInput) =>
  unwrapCommand(commands.gamePartyCreate(input));
export const gamePartyJoin = (input: GamePartyJoinInput) =>
  unwrapCommand(commands.gamePartyJoin(input));
/** 恢复凭据由 Rust 保存并轮换，前端只提交当前运行期身份。 */
export const gamePartyResume = (instanceId: string) =>
  unwrapCommand(commands.gamePartyResume(instanceId));
export const gamePartySend = (
  instanceId: string,
  targetMemberId: string | null,
  envelope: GamePartyEnvelope,
) => voidCommand(commands.gamePartySend(instanceId, targetMemberId, envelope));
