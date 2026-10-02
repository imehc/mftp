import { useEffect, useState, useSyncExternalStore } from "react";
import { useLingui } from "@lingui/react/macro";
import { gameRoomCreate, gameRoomJoin, lanTransferSettings } from "~/lib/ipc";
import type { GameRoomSummary } from "~/types";
import type { RoomOwner } from "./roomOwner";
import { onlineGameId, type MoveParser } from "./protocol";
import { useRoomDiscovery } from "./useRoomDiscovery";
import { parseRoomAddress } from "./room-address";

export function useOnlineLobby<M>(
  gameId: string,
  parseMove: MoveParser<M>,
  owner: RoomOwner<M>,
) {
  const { t } = useLingui();
  // 发现与连接共用带协议版本的标识，旧客户端不能混入新房间。
  const roomGameId = onlineGameId(gameId);
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  const discovery = useRoomDiscovery(roomGameId, !state.hosting && !state.busy);
  const [nickname, setNickname] = useState("");
  const [roomName, setRoomName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [joinOpen, setJoinOpen] = useState(false);
  const [manualAddr, setManualAddr] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [codeRequired, setCodeRequired] = useState(false);
  const [addressInvalid, setAddressInvalid] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void lanTransferSettings()
      .then((settings) => {
        if (!cancelled && settings.deviceName)
          setNickname((current) => current || settings.deviceName);
      })
      .catch(() => {
        /* 昵称为可选默认值；读取失败仍可手动填写，不阻断联机。 */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const playerName = () => nickname.trim() || t`玩家`;
  const create = () => {
    const name = playerName();
    return owner.start(parseMove, () =>
      gameRoomCreate(
        roomGameId,
        roomName.trim() || t`${name} 的房间`,
        roomCode.trim() || null,
        name,
      ),
    );
  };
  const openJoin = (room?: GameRoomSummary) => {
    setAddressInvalid(false);
    setCodeRequired(!!room?.hasCode);
    if (room)
      setManualAddr(
        `${room.ip.includes(":") ? `[${room.ip}]` : room.ip}:${room.port}`,
      );
    setJoinCode("");
    setJoinOpen(true);
  };
  const join = () => {
    const address = parseRoomAddress(manualAddr);
    setAddressInvalid(!address);
    if (!address || (codeRequired && !joinCode.trim())) return;
    return owner.start(parseMove, () =>
      gameRoomJoin(
        address.host,
        address.port,
        roomGameId,
        joinCode.trim() || null,
        playerName(),
      ),
    );
  };
  const closeJoin = async () => {
    // 先完成旧启动请求的条件清理，再允许界面发起新的连接。
    await owner.cancel();
    setJoinOpen(false);
  };
  return {
    ...state,
    discovery,
    nickname,
    setNickname,
    roomName,
    setRoomName,
    roomCode,
    setRoomCode,
    joinOpen,
    manualAddr,
    setManualAddr,
    joinCode,
    setJoinCode,
    codeRequired,
    addressInvalid,
    create,
    openJoin,
    join,
    closeJoin,
    cancel: () => owner.cancel(),
  };
}
