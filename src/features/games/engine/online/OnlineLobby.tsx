/**
 * Generic LAN lobby shared by all mini-games: create a room (optional
 * room code), browse nearby rooms via mDNS, or join a typed IP:port as
 * the fallback for networks that filter multicast. Hands a live
 * OnlineMatchSession to the caller once both seats are filled.
 */
import { useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { KeyRound, RefreshCw, Radio, Users } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  gameRoomCreate,
  gameRoomDiscover,
  gameRoomJoin,
  gameRoomLeave,
  gameRoomStatus,
  lanTransferSettings,
} from "~/lib/ipc";
import type { GameRoomStatus, GameRoomSummary } from "~/types";
import { OnlineMatchSession } from "./session";

export interface OnlineLobbyReady<M> {
  session: OnlineMatchSession<M>;
  status: GameRoomStatus;
}

export function OnlineLobby<M>({
  gameId,
  onReady,
}: {
  gameId: string;
  onReady(ready: OnlineLobbyReady<M>): void;
}) {
  const { t } = useLingui();
  const [nickname, setNickname] = useState("");
  const [roomName, setRoomName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [rooms, setRooms] = useState<GameRoomSummary[]>([]);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hosting, setHosting] = useState<GameRoomStatus | null>(null);
  const [joinTarget, setJoinTarget] = useState<GameRoomSummary | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [manualAddr, setManualAddr] = useState("");
  const [manualCode, setManualCode] = useState("");
  const sessionRef = useRef<OnlineMatchSession<M> | null>(null);
  const handedOffRef = useRef(false);

  // Default the nickname to the device name used by LAN transfer.
  useEffect(() => {
    let cancelled = false;
    void lanTransferSettings()
      .then((settings) => {
        if (!cancelled && settings.deviceName) {
          setNickname((current) => current || settings.deviceName);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll discovery while browsing; each scan itself blocks ~1.2s in Rust.
  useEffect(() => {
    if (hosting) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scan = async () => {
      setScanning(true);
      try {
        const found = await gameRoomDiscover(gameId);
        if (!cancelled) setRooms(found);
      } catch {
        // No Tauri bridge (plain browser) — leave the list empty.
      }
      if (!cancelled) {
        setScanning(false);
        timer = setTimeout(scan, 4000);
      }
    };
    void scan();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [gameId, hosting]);

  // Tear the room down unless the session was handed to the match screen.
  useEffect(
    () => () => {
      if (handedOffRef.current) return;
      sessionRef.current?.close();
      void gameRoomLeave().catch(() => {});
    },
    [],
  );

  const playerName = () => nickname.trim() || t`玩家`;

  const handOff = (session: OnlineMatchSession<M>, status: GameRoomStatus) => {
    if (handedOffRef.current) return;
    handedOffRef.current = true;
    onReady({ session, status });
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const name = playerName();
      const status = await gameRoomCreate(
        gameId,
        roomName.trim() || t`${name} 的房间`,
        roomCode.trim() || null,
        name,
      );
      const session = await OnlineMatchSession.create<M>(status);
      sessionRef.current = session;
      session.onPeerPresence((connected) => {
        if (!connected) return;
        void gameRoomStatus()
          .then((fresh) => handOff(session, fresh))
          .catch(() => handOff(session, status));
      });
      setHosting(status);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const join = async (host: string, port: number, code: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const status = await gameRoomJoin(host, port, gameId, code, playerName());
      const session = await OnlineMatchSession.create<M>(status);
      sessionRef.current = session;
      handOff(session, status);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const joinManual = () => {
    const [host, portRaw] = manualAddr.trim().split(":");
    const port = Number(portRaw);
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
      setError(t`地址格式应为 IP:端口`);
      return;
    }
    void join(host, port, manualCode.trim() || null);
  };

  const cancelHosting = () => {
    sessionRef.current?.close();
    sessionRef.current = null;
    setHosting(null);
    void gameRoomLeave().catch(() => {});
  };

  if (hosting) {
    return (
      <div className="flex flex-1 justify-center overflow-auto p-3">
        <div className="flex w-full max-w-sm flex-col gap-3 self-center rounded-md border border-border p-4">
          <div className="text-center text-sm font-medium">{hosting.roomName}</div>
          <div className="text-center text-xs text-muted-foreground">
            {hosting.host}:{hosting.port}
          </div>
          {hosting.code ? (
            <div className="text-center">
              <div className="text-xs text-muted-foreground">
                <Trans>房间码</Trans>
              </div>
              <div className="font-mono text-2xl font-semibold tracking-widest">
                {hosting.code}
              </div>
            </div>
          ) : null}
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
            <Trans>等待对手加入…</Trans>
          </div>
          <Button variant="outline" size="sm" onClick={cancelHosting}>
            <Trans>取消</Trans>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 justify-center overflow-auto p-3">
      <div className="flex w-full max-w-sm flex-col gap-2 self-center">
        <label className="flex items-center gap-2 text-xs">
          <span className="shrink-0 text-muted-foreground">
            <Trans>昵称</Trans>
          </span>
          <Input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder={t`玩家`}
            className="h-7 text-xs"
          />
        </label>

        <div className="flex flex-col gap-2 rounded-md border border-border p-2.5">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Users className="size-4" />
            <Trans>创建房间</Trans>
          </span>
          <div className="flex gap-2">
            <Input
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder={t`房间名（可选）`}
              className="h-7 flex-1 text-xs"
            />
            <Input
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              placeholder={t`房间码（可选）`}
              className="h-7 w-28 text-xs"
            />
          </div>
          <Button size="sm" disabled={busy} onClick={() => void create()}>
            <Trans>创建并等待对手</Trans>
          </Button>
        </div>

        <div className="flex flex-col gap-1.5 rounded-md border border-border p-2.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Radio className="size-4" />
              <Trans>附近的房间</Trans>
            </span>
            <RefreshCw
              className={`size-3.5 text-muted-foreground ${scanning ? "animate-spin" : ""}`}
            />
          </div>
          {rooms.length === 0 ? (
            <div className="py-1 text-center text-xs text-muted-foreground">
              <Trans>正在搜索…未发现房间时可用下方地址直连</Trans>
            </div>
          ) : (
            <ul className="flex max-h-40 flex-col gap-1 overflow-auto">
              {rooms.map((room) => (
                <li
                  key={room.roomId}
                  className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 truncate text-xs font-medium">
                      {room.roomName}
                      {room.hasCode ? (
                        <KeyRound className="size-3 shrink-0 text-muted-foreground" />
                      ) : null}
                    </div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {room.hostName} · {room.ip}:{room.port}
                    </div>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      if (room.hasCode) {
                        setJoinCode("");
                        setJoinTarget(room);
                      } else {
                        void join(room.ip, room.port, null);
                      }
                    }}
                  >
                    <Trans>加入</Trans>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={manualAddr}
            onChange={(e) => setManualAddr(e.target.value)}
            placeholder={t`IP:端口 直连`}
            className="h-7 flex-1 text-xs"
          />
          <Input
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder={t`房间码`}
            className="h-7 w-24 text-xs"
          />
          <Button size="xs" variant="outline" disabled={busy} onClick={joinManual}>
            <Trans>直连</Trans>
          </Button>
        </div>

        {error ? (
          <div className="text-center text-xs text-destructive">{error}</div>
        ) : null}
        <Badge variant="outline" className="self-center text-[10px] font-normal">
          <Trans>仅限同一局域网内联机</Trans>
        </Badge>
      </div>

      <AlertDialog
        open={joinTarget !== null}
        onOpenChange={(open) => {
          if (!open) setJoinTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>输入房间码</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              {joinTarget?.roomName} · {joinTarget?.ip}:{joinTarget?.port}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            autoFocus
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder={t`房间码`}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={joinCode.trim().length === 0}
              onClick={() => {
                const target = joinTarget;
                setJoinTarget(null);
                if (target) void join(target.ip, target.port, joinCode.trim());
              }}
            >
              <Trans>加入</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
