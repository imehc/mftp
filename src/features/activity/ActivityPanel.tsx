import { Trans, useLingui } from "@lingui/react/macro";
import { X } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { useDesktopLayout } from "~/lib/use-desktop-layout";

import { isInsideModalDialog } from "./activity-navigation";
import { ActivityCenter, type ActivityTab } from "./ActivityCenter";
import {
  ACTIVITY_PANEL_ID,
  useActivityExecutionLogs,
  useActivityPanel,
} from "./ActivityProvider";

/** 桌面端非模态活动面板；窄视口改用 /activity 整页。 */
export default function ActivityPanel() {
  const { panelOpen } = useActivityPanel();
  const wide = useDesktopLayout();
  if (!wide || !panelOpen) return null;
  return <ActivityPanelContent />;
}

function ActivityPanelContent() {
  const { t } = useLingui();
  const { closePanel } = useActivityPanel();
  const logs = useActivityExecutionLogs();
  const [tab, setTab] = useState<ActivityTab>("tasks");
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const closeWithDiscard = () => {
    logs.clear();
    closePanel();
  };

  const closeOnEscape = useEffectEvent(closeWithDiscard);

  useEffect(() => {
    const active = document.activeElement;
    opener.current =
      active instanceof HTMLElement && active !== document.body
        ? active
        : document.querySelector<HTMLElement>('[data-activity-entry="rail"]');
    closeButton.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 避免弹窗关闭 Esc 连带关闭面板并丢弃日志。
      if (isInsideModalDialog(event.target)) return;
      event.preventDefault();
      closeOnEscape();
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // 触发器可能因导航或视口切换卸载；不可见时不要把焦点丢到 body。
      const target = opener.current;
      if (target?.isConnected && target.getClientRects().length) target.focus();
    };
  }, []);
  return (
    <aside
      id={ACTIVITY_PANEL_ID}
      ref={panel}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-activity-panel
      className="ui-density-adaptive bg-background fixed top-[var(--safe-top,0px)] right-[var(--safe-right,0px)] bottom-[var(--safe-bottom,0px)] z-40 flex w-[min(24rem,max(20rem,32vw))] flex-col border-l shadow-2xl outline-none"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b p-3">
        <h2 id={titleId} className="text-sm font-semibold">
          <Trans>活动</Trans>
        </h2>
        <Button
          ref={closeButton}
          variant="ghost"
          size="icon-sm"
          density="adaptive"
          aria-label={t`关闭活动面板`}
          title={t`关闭活动面板`}
          onClick={closeWithDiscard}
        >
          <X />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col p-3">
        <ActivityCenter
          mode="panel"
          tab={tab}
          onTabChange={setTab}
          onNavigate={closeWithDiscard}
          onClose={closeWithDiscard}
        />
      </div>
    </aside>
  );
}
