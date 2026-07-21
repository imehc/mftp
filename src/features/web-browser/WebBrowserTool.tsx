import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ExternalLink,
  Globe,
  Home,
  Minimize2,
  RefreshCw,
  Settings2,
  Star,
  Maximize2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutFooter,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { normalizeWebUrl } from "~/features/web-browser/url";
import { useSettingsStore } from "~/store/settings";

export default function WebBrowserTool() {
  const { t } = useLingui();
  const addressInputId = useId();
  const defaultUrlInputId = useId();
  const defaultUrl = useSettingsStore((s) => s.webBrowserDefaultUrl);
  const restoreWindowFullscreenRef = useRef<boolean | null>(null);
  const setWebBrowserDefaultUrl = useSettingsStore(
    (s) => s.setWebBrowserDefaultUrl,
  );

  const [address, setAddress] = useState(defaultUrl);
  const [activeUrl, setActiveUrl] = useState(() => normalizeWebUrl(defaultUrl));
  const [reloadToken, setReloadToken] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftDefaultUrl, setDraftDefaultUrl] = useState(defaultUrl);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);

  useEffect(() => {
    setAddress((current) => (current.trim() ? current : defaultUrl));
    setActiveUrl((current) => current ?? normalizeWebUrl(defaultUrl));
  }, [defaultUrl]);

  useEffect(() => {
    if (settingsOpen) {
      setDraftDefaultUrl(defaultUrl);
    }
  }, [defaultUrl, settingsOpen]);

  useEffect(() => {
    if (!previewFullscreen) return undefined;
    let disposed = false;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    async function enterWindowFullscreen() {
      try {
        const appWindow = getCurrentWindow();
        const wasFullscreen = await appWindow.isFullscreen();
        if (disposed) return;
        restoreWindowFullscreenRef.current = wasFullscreen;
        if (!wasFullscreen) {
          await appWindow.setFullscreen(true);
        }
      } catch {
        restoreWindowFullscreenRef.current = null;
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPreviewFullscreen(false);
      }
    }

    void enterWindowFullscreen();
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      disposed = true;
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      const shouldRestoreWindow = restoreWindowFullscreenRef.current === false;
      restoreWindowFullscreenRef.current = null;
      if (shouldRestoreWindow) {
        void getCurrentWindow().setFullscreen(false).catch(() => undefined);
      }
    };
  }, [previewFullscreen]);

  const canOpenExternal = useMemo(
    () => Boolean(activeUrl),
    [activeUrl],
  );

  function navigateTo(raw: string) {
    const next = normalizeWebUrl(raw);
    if (!next) {
      toast.error(t`请输入有效的 http 或 https 地址`);
      return;
    }
    setAddress(next);
    setActiveUrl(next);
    setReloadToken((token) => token + 1);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigateTo(address);
  }

  function handleReload() {
    if (!activeUrl) {
      navigateTo(address || defaultUrl);
      return;
    }
    setReloadToken((token) => token + 1);
  }

  function handleGoHome() {
    if (!defaultUrl.trim()) {
      toast.error(t`尚未设置默认地址`);
      return;
    }
    navigateTo(defaultUrl);
  }

  async function handleOpenExternal() {
    const target = activeUrl ?? normalizeWebUrl(address);
    if (!target) {
      toast.error(t`请输入有效的 http 或 https 地址`);
      return;
    }
    try {
      await openUrl(target);
    } catch (error) {
      toast.error(String(error));
    }
  }

  function handleSetCurrentAsDefault() {
    const target = activeUrl ?? normalizeWebUrl(address);
    if (!target) {
      toast.error(t`请输入有效的 http 或 https 地址`);
      return;
    }
    setWebBrowserDefaultUrl(target);
    toast.success(t`已设为默认地址`);
  }

  function handleSaveDefaultUrl() {
    const trimmed = draftDefaultUrl.trim();
    if (!trimmed) {
      setWebBrowserDefaultUrl("");
      setSettingsOpen(false);
      toast.success(t`已清除默认地址`);
      return;
    }
    const next = normalizeWebUrl(trimmed);
    if (!next) {
      toast.error(t`请输入有效的 http 或 https 地址`);
      return;
    }
    setWebBrowserDefaultUrl(next);
    setDraftDefaultUrl(next);
    setSettingsOpen(false);
    toast.success(t`默认地址已保存`);
  }

  function handleToggleFullscreen() {
    const target = activeUrl ?? normalizeWebUrl(address || defaultUrl);
    if (!target) {
      toast.error(t`请输入有效的 http 或 https 地址`);
      return;
    }
    if (!activeUrl) {
      setAddress(target);
      setActiveUrl(target);
      setReloadToken((token) => token + 1);
      setPreviewFullscreen(true);
      return;
    }
    setPreviewFullscreen((current) => !current);
  }

  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Button variant="ghost" size="xs" asChild>
            <Link to="/">
              <Home data-icon="inline-start" />
              <Trans>首页</Trans>
            </Link>
          </Button>
          <div className="hidden h-4 w-px bg-border sm:block" />
          <div className="hidden truncate text-xs font-medium text-muted-foreground sm:block">
            <Trans>网页访问</Trans>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Badge variant="outline">
            <Trans>数据连接</Trans>
          </Badge>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setSettingsOpen(true)}
            aria-label={t`网页访问设置`}
            title={t`网页访问设置`}
          >
            <Settings2 />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2.5 sm:p-3">
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2 sm:flex-row sm:items-center"
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <label htmlFor={addressInputId} className="sr-only">
              <Trans>网址</Trans>
            </label>
            <Input
              id={addressInputId}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder={t`输入网址，例如 192.168.1.1 或 https://example.com`}
              className="min-w-0 flex-1 font-mono text-sm"
              inputMode="url"
              enterKeyHint="go"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button type="submit" size="sm">
              <Trans>访问</Trans>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={handleReload}
              aria-label={t`刷新`}
              title={t`刷新`}
            >
              <RefreshCw />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={handleGoHome}
              aria-label={t`打开默认地址`}
              title={t`打开默认地址`}
            >
              <Home />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => void handleOpenExternal()}
              disabled={!canOpenExternal && !address.trim()}
              aria-label={t`在系统浏览器中打开`}
              title={t`在系统浏览器中打开`}
            >
              <ExternalLink />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={handleSetCurrentAsDefault}
              aria-label={t`设为默认地址`}
              title={t`设为默认地址`}
            >
              <Star />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={handleToggleFullscreen}
              disabled={!canOpenExternal && !address.trim()}
              aria-label={previewFullscreen ? t`退出全屏预览` : t`全屏预览`}
              title={previewFullscreen ? t`退出全屏预览` : t`全屏预览`}
            >
              {previewFullscreen ? <Minimize2 /> : <Maximize2 />}
            </Button>
          </div>
        </form>

        <section
          className={
            previewFullscreen
              ? "fixed inset-0 z-50 overflow-hidden bg-background"
              : "relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card"
          }
        >
          {activeUrl ? (
            <>
              <iframe
                key={`${activeUrl}:${reloadToken}`}
                title={t`网页预览`}
                src={activeUrl}
                className="size-full border-0 bg-background"
                sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts allow-downloads"
                referrerPolicy="no-referrer-when-downgrade"
              />
              {previewFullscreen ? (
                <div className="absolute right-3 top-3 flex items-center gap-1 opacity-70 transition-opacity hover:opacity-100 focus-within:opacity-100">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    onClick={handleReload}
                    aria-label={t`刷新`}
                    title={t`刷新`}
                  >
                    <RefreshCw />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    onClick={() => setPreviewFullscreen(false)}
                    aria-label={t`退出全屏预览`}
                    title={t`退出全屏预览`}
                  >
                    <Minimize2 />
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <Empty className="size-full border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Globe />
                </EmptyMedia>
                <EmptyTitle>
                  <Trans>输入地址开始访问</Trans>
                </EmptyTitle>
                <EmptyDescription>
                  {defaultUrl ? (
                    <Trans>
                      可直接访问默认地址，或在地址栏输入新的网页链接。
                    </Trans>
                  ) : (
                    <Trans>
                      在地址栏输入网址，或先在设置中配置进入模块时的默认地址。
                    </Trans>
                  )}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {defaultUrl ? (
                  <Button size="sm" onClick={handleGoHome}>
                    <Trans>打开默认地址</Trans>
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setSettingsOpen(true)}>
                    <Trans>设置默认地址</Trans>
                  </Button>
                )}
              </EmptyContent>
            </Empty>
          )}
        </section>
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogLayoutContent className="sm:max-w-md">
          <DialogLayoutHeader>
            <DialogTitle>
              <Trans>网页访问设置</Trans>
            </DialogTitle>
          </DialogLayoutHeader>
          <DialogLayoutBody className="gap-3">
            <Field>
              <FieldLabel htmlFor={defaultUrlInputId}>
                <Trans>默认地址</Trans>
              </FieldLabel>
              <Input
                id={defaultUrlInputId}
                value={draftDefaultUrl}
                onChange={(event) => setDraftDefaultUrl(event.target.value)}
                placeholder={t`例如 https://192.168.1.1`}
                className="font-mono text-sm"
                inputMode="url"
              />
              <FieldDescription>
                <Trans>
                  进入「网页访问」模块时将优先打开该地址。留空表示不自动打开。
                </Trans>
              </FieldDescription>
            </Field>
          </DialogLayoutBody>
          <DialogLayoutFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSettingsOpen(false)}
            >
              <Trans>取消</Trans>
            </Button>
            <Button type="button" onClick={handleSaveDefaultUrl}>
              <Trans>保存</Trans>
            </Button>
          </DialogLayoutFooter>
        </DialogLayoutContent>
      </Dialog>
    </main>
  );
}
