import { Trans, useLingui } from "@lingui/react/macro";
import {
  ArrowLeft,
  KeyRound,
  Link2,
  Plus,
  RefreshCw,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { CopyButton } from "~/components/CopyButton";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Button } from "~/components/ui/button";
import { Dialog, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutFooter,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { PasswordInput } from "~/components/ui/password-input";
import { describeError } from "~/lib/errors";

import type { MoveParser } from "./protocol";
import type { RoomOwner } from "./roomOwner";
import { useOnlineLobby } from "./use-online-lobby";

export function OnlineLobby<M>({
  gameId,
  parseMove,
  owner,
  onExit,
}: {
  gameId: string;
  parseMove: MoveParser<M>;
  owner: RoomOwner<M>;
  onExit: () => void;
}) {
  const { t } = useLingui();
  const c = useOnlineLobby(gameId, parseMove, owner);
  const report = (error: unknown) => toast.error(describeError(error));

  const back = async () => {
    await c.cancel();
    onExit();
  };

  return (
    <>
      <ToolPageHeader
        showHome={false}
        title={c.hosting?.roomName || <Trans>联机对局</Trans>}
        leading={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t`返回模式选择`}
            disabled={c.cancelling}
            onClick={() => void back()}
          >
            <ArrowLeft />
          </Button>
        }
        trailing={
          c.hosting ? (
            <Button
              variant="ghost"
              density="adaptive"
              size="sm"
              disabled={c.busy}
              onClick={() => void c.cancel()}
            >
              <Trans>取消等待</Trans>
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`刷新房间`}
              disabled={c.discovery.scanning || c.busy}
              onClick={c.discovery.refresh}
            >
              <RefreshCw
                className={
                  c.discovery.scanning ? "motion-safe:animate-spin" : undefined
                }
              />
            </Button>
          )
        }
      />
      <div className="app-scroll-safe-end min-h-0 flex-1 overflow-auto px-3 pt-3 md:px-4 md:pt-4">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
          {c.hosting ? (
            <>
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <Users className="bg-muted size-12 rounded-xl p-3" />
                <h2 className="text-sm font-semibold">
                  <Trans>等待对手加入…</Trans>
                </h2>
                <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
                  <span className="break-all">
                    {c.hosting.host}:{c.hosting.port}
                  </span>
                  <CopyButton
                    value={`${c.hosting.host}:${c.hosting.port}`}
                    variant="ghost"
                    size="icon-sm"
                    label={t`复制地址`}
                    onError={report}
                  />
                </div>
              </div>
              {c.hosting.code ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border p-4">
                  <div>
                    <Label>
                      <Trans>房间码</Trans>
                    </Label>
                    <p className="mt-1 font-mono text-sm">{c.hosting.code}</p>
                  </div>
                  <CopyButton
                    value={c.hosting.code}
                    variant="outline"
                    size="sm"
                    density="adaptive"
                    label={t`复制房间码`}
                    onError={report}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <>
              <section className="min-w-0 rounded-xl border p-4">
                <h2 className="text-sm font-semibold">
                  <Trans>附近的房间</Trans>
                </h2>
                {c.discovery.error ? (
                  <p role="alert" className="text-destructive my-3 text-sm">
                    {describeError(c.discovery.error)}
                  </p>
                ) : c.discovery.rooms.length === 0 ? (
                  <p
                    role="status"
                    className="text-muted-foreground my-3 text-sm"
                  >
                    {c.discovery.scanning ? (
                      <Trans>正在搜索…</Trans>
                    ) : (
                      <Trans>未发现房间，可输入地址加入</Trans>
                    )}
                  </p>
                ) : null}
                <ul className="my-2 divide-y">
                  {c.discovery.rooms.map((room) => (
                    <li
                      key={room.roomId}
                      className="flex min-w-0 items-center gap-3 py-3"
                    >
                      <Users className="text-muted-foreground size-5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-sm font-medium">
                          <span className="truncate">
                            {room.roomName ?? t`房间`}
                          </span>
                          {room.hasCode ? (
                            <KeyRound
                              className="size-3.5 shrink-0"
                              aria-label={t`需要房间码`}
                            />
                          ) : null}
                        </div>
                        <p className="text-muted-foreground truncate text-xs">
                          {room.hostName ?? t`玩家`} · {room.ip}:{room.port}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        density="adaptive"
                        disabled={c.busy}
                        onClick={() => c.openJoin(room)}
                      >
                        <Trans>加入</Trans>
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button
                  fullWidth
                  variant="outline"
                  className="md:w-fit"
                  disabled={c.busy}
                  onClick={() => c.openJoin()}
                >
                  <Link2 />
                  <Trans>输入地址</Trans>
                </Button>
              </section>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void c.create();
                }}
                className="rounded-xl border p-4"
              >
                <fieldset
                  disabled={c.busy}
                  className="flex min-w-0 flex-col gap-3"
                >
                  <h2 className="text-sm font-semibold">
                    <Trans>创建房间</Trans>
                  </h2>
                  <div className="space-y-1.5">
                    <Label htmlFor="room-nickname">
                      <Trans>昵称</Trans>
                    </Label>
                    <Input
                      id="room-nickname"
                      value={c.nickname}
                      onChange={(e) => c.setNickname(e.target.value)}
                      placeholder={t`玩家`}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="room-name">
                      <Trans>房间名称</Trans>
                    </Label>
                    <Input
                      id="room-name"
                      value={c.roomName}
                      onChange={(e) => c.setRoomName(e.target.value)}
                      placeholder={t`房间名（可选）`}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="room-code">
                      <Trans>房间码（可选）</Trans>
                    </Label>
                    <PasswordInput
                      id="room-code"
                      value={c.roomCode}
                      onChange={(e) => c.setRoomCode(e.target.value)}
                    />
                  </div>
                  <Button
                    type="submit"
                    fullWidth
                    className="md:w-fit md:self-start"
                  >
                    <Plus />
                    <Trans>创建房间</Trans>
                  </Button>
                </fieldset>
              </form>
            </>
          )}
          {c.error && !c.joinOpen ? (
            <p role="alert" className="text-destructive text-sm">
              {describeError(c.error)}
            </p>
          ) : null}
          {c.busy && !c.hosting && !c.joinOpen ? (
            <Button
              fullWidth
              variant="outline"
              disabled={c.cancelling}
              onClick={() => void c.cancel()}
            >
              <Trans>取消连接</Trans>
            </Button>
          ) : null}
          <p className="text-muted-foreground text-center text-xs">
            <Trans>仅限同一局域网内联机</Trans>
          </p>
        </div>
      </div>
      <Dialog
        open={c.joinOpen}
        onOpenChange={(open) => {
          if (!open && !c.cancelling) void c.closeJoin();
        }}
      >
        <DialogLayoutContent
          placement="responsive-page"
          className="ui-density-adaptive md:max-w-md"
          showCloseButton={false}
          aria-describedby={undefined}
        >
          <DialogLayoutHeader showCloseButton>
            <DialogTitle>
              <Trans>加入房间</Trans>
            </DialogTitle>
          </DialogLayoutHeader>
          <DialogLayoutBody>
            <form
              id="join-room"
              onSubmit={(e) => {
                e.preventDefault();
                void c.join();
              }}
            >
              <fieldset
                disabled={c.busy}
                className="flex min-w-0 flex-col gap-3 p-1"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="join-address">
                    <Trans>地址</Trans>
                  </Label>
                  <Input
                    id="join-address"
                    value={c.manualAddr}
                    onChange={(e) => c.setManualAddr(e.target.value)}
                    placeholder={t`IP:端口 直连`}
                    aria-invalid={c.addressInvalid}
                    aria-describedby={
                      c.addressInvalid ? "join-address-error" : undefined
                    }
                  />
                  {c.addressInvalid ? (
                    <p
                      id="join-address-error"
                      className="text-destructive text-xs"
                    >
                      <Trans>地址格式应为 IP:端口</Trans>
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="join-nickname">
                    <Trans>昵称</Trans>
                  </Label>
                  <Input
                    id="join-nickname"
                    value={c.nickname}
                    onChange={(e) => c.setNickname(e.target.value)}
                    placeholder={t`玩家`}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="join-code">
                    <Trans>房间码</Trans>
                  </Label>
                  <PasswordInput
                    id="join-code"
                    value={c.joinCode}
                    onChange={(e) => c.setJoinCode(e.target.value)}
                    required={c.codeRequired}
                  />
                </div>
              </fieldset>
            </form>
            {c.error ? (
              <p role="alert" className="text-destructive mt-3 text-sm">
                {describeError(c.error)}
              </p>
            ) : null}
          </DialogLayoutBody>
          <DialogLayoutFooter>
            <Button
              variant="outline"
              disabled={c.cancelling}
              onClick={() => void c.closeJoin()}
            >
              {c.busy ? <Trans>取消连接</Trans> : <Trans>取消</Trans>}
            </Button>
            <Button
              type="submit"
              form="join-room"
              disabled={c.busy || (c.codeRequired && !c.joinCode.trim())}
            >
              {c.busy ? <Trans>连接中…</Trans> : <Trans>加入</Trans>}
            </Button>
          </DialogLayoutFooter>
        </DialogLayoutContent>
      </Dialog>
    </>
  );
}
