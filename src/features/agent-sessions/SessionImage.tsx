import { Trans, useLingui } from "@lingui/react/macro";
import { ImageOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { AgentSessionImageRef } from "~/bindings";
import { Dialog, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import { Spinner } from "~/components/ui/spinner";
import { agentSessionImage, agentSessionsCancel } from "~/lib/ipc";

export function SessionImage({
  image,
  generation,
  sessionKey,
  messageIndex,
}: {
  image: AgentSessionImageRef;
  generation: string;
  sessionKey: string;
  messageIndex: number;
}) {
  const { t } = useLingui();
  const root = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    let requestId: string | null = null;
    let started = false;

    async function load() {
      if (started) return;
      started = true;
      requestId = crypto.randomUUID();
      try {
        const payload = await agentSessionImage(
          generation,
          sessionKey,
          messageIndex,
          image.index,
          requestId,
        );
        if (!active) return;
        const bytes = Uint8Array.from(atob(payload.dataBase64), (char) =>
          char.charCodeAt(0),
        );
        objectUrl = URL.createObjectURL(
          new Blob([bytes], { type: payload.mime }),
        );
        setSrc(objectUrl);
      } catch {
        if (active) setFailed(true);
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void load();
      },
      { rootMargin: "200px" },
    );
    if (root.current) observer.observe(root.current);
    return () => {
      active = false;
      observer.disconnect();
      if (requestId) void agentSessionsCancel(requestId).catch(() => {});
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [generation, sessionKey, messageIndex, image.index]);
  return (
    <div
      ref={root}
      className="bg-muted/40 flex min-h-24 min-w-0 items-center justify-center overflow-hidden rounded-lg"
    >
      {failed ? (
        <div className="app-description flex items-center gap-2 p-3">
          <ImageOff className="size-4" />
          <Trans>图片不可用</Trans>
        </div>
      ) : src ? (
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              className="focus-visible:ring-ring max-w-full rounded-lg outline-none focus-visible:ring-2"
              aria-label={t`查看图片`}
            >
              <img
                src={src}
                alt={image.name === "image" ? t`对话图片` : image.name}
                className="max-h-64 max-w-full object-contain"
                onError={() => setFailed(true)}
              />
            </button>
          </DialogTrigger>
          <DialogLayoutContent className="sm:max-w-2xl">
            <DialogLayoutHeader>
              <DialogTitle>
                {image.name === "image" ? t`对话图片` : image.name}
              </DialogTitle>
            </DialogLayoutHeader>
            <DialogLayoutBody>
              <img
                src={src}
                alt={image.name === "image" ? t`对话图片` : image.name}
                className="mx-auto max-h-[70dvh] max-w-full object-contain"
              />
            </DialogLayoutBody>
          </DialogLayoutContent>
        </Dialog>
      ) : (
        <Spinner />
      )}
    </div>
  );
}
