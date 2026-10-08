import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import { Box, FolderOpen, Library } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import AppPageLayout from "~/components/AppPageLayout";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { listenNativeFileDrop } from "~/lib/events";
import {
  isTauriRuntime,
  pickFilePathNative,
  pickFilePathsNative,
} from "~/lib/files";
import { formatBytes } from "~/lib/format";
import { isMobilePlatform } from "~/lib/platform";

import { AnimationBar } from "./components/AnimationBar";
import { CanvasControls } from "./components/CanvasControls";
import { ImportStatus } from "./components/ImportStatus";
import { LibraryPanel, LibraryStatus } from "./components/LibraryPanel";
import { MemoryWarning } from "./components/MemoryPanel";
import { ViewerHelp } from "./components/ViewerHelp";
import { ViewGizmo } from "./components/ViewGizmo";
import { WorkspaceInspector } from "./components/WorkspaceInspector";
import { modelError } from "./domain/errors";
import { modelFileAccept } from "./domain/formats";
import { ModelLibraryController } from "./library/controller";
import { modelExtensions } from "./loaders/registry";
import { ViewerSession } from "./runtime/session";
import { browserSource } from "./sources/browser";
import { nativeSource } from "./sources/native";
import { isModelName } from "./sources/paths";

export default function ModelViewerPage() {
  const { t } = useLingui();
  const [session] = useState(() => new ViewerSession());
  const [library] = useState(() => new ModelLibraryController(session));
  const [libraryOpen, setLibraryOpen] = useState(false);
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const canvas = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const supplement = useRef<HTMLInputElement>(null);
  const supplementKey = useRef("");
  const supplementId = useRef<string | null>(null);
  const [hovering, setHovering] = useState(false);
  const context = state.context;
  const [attempt, setAttempt] = useState(0);
  const [help, setHelp] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const nativeDesktop = isTauriRuntime() && !isMobilePlatform();

  useEffect(() => {
    if (!canvas.current) return;
    session.connect(canvas.current);
    if (isTauriRuntime()) library.start();
    return () => {
      library.stop();
      session.dispose();
    };
  }, [session, library, attempt]);

  useEffect(() => {
    session.runtime?.setInteractive(!help && !inspectorOpen && !libraryOpen);
  }, [help, inspectorOpen, libraryOpen, session, attempt]);
  useEffect(() => {
    const exitPlacement = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !help &&
        !inspectorOpen &&
        !libraryOpen &&
        session.runtime &&
        session.runtime.tools.snapshot().mode !== "orbit"
      ) {
        session.runtime.setMode("orbit");
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", exitPlacement);
    return () => window.removeEventListener("keydown", exitPlacement);
  }, [session, help, inspectorOpen, libraryOpen]);
  useEffect(() => {
    if (!nativeDesktop) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void listenNativeFileDrop(
      (paths) => {
        if (!active) return;
        const entries = paths.filter(isModelName);
        if (!entries.length) {
          session.report(modelError("unsupported"));
          return;
        }
        void session.enqueue(
          entries.map((path) => ({
            name: path.split(/[\\/]/).pop() ?? path,
            open: () => nativeSource(path, paths),
          })),
        );
      },
      (value) => {
        if (active) setHovering(value);
      },
    )
      .then((listener) => {
        if (active) unlisten = listener;
        else listener();
      })
      .catch((error) => {
        if (active) session.report(error);
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [session, nativeDesktop]);

  async function chooseModel() {
    if (!nativeDesktop) {
      input.current?.click();
      return;
    }
    try {
      const paths = await pickFilePathsNative({
        filterName: t({
          message: "3D 模型",
          comment: "本地 GLB、glTF、FBX 三维模型查看工具名称。",
        }),
        extensions: modelExtensions,
      });
      if (paths?.length)
        await session.enqueue(
          paths.map((path) => ({
            name: path.split(/[\\/]/).pop() ?? path,
            open: () => nativeSource(path, paths),
          })),
        );
    } catch (error) {
      session.report(error);
    }
  }

  async function chooseDependency(key: string) {
    const target = state.awaitingId;
    if (!target) return;
    if (!nativeDesktop) {
      supplementKey.current = key;
      supplementId.current = target;
      supplement.current?.click();
      return;
    }
    try {
      const path = await pickFilePathNative({
        title: key,
        filterName: t({
          message: "模型依赖文件",
          comment: "3D 模型的二进制数据或纹理文件选择器类型。",
        }),
        extensions: ["*"],
      });
      if (typeof path === "string") await session.attach(key, path, target);
    } catch (error) {
      session.report(error);
    }
  }

  const ready = context === "ready";

  function openFiles(files: File[]) {
    const entries = files.filter((file) => isModelName(file.name));
    if (!entries.length) {
      session.report(modelError("unsupported"));
      return;
    }
    void session.enqueue(
      entries.map((entry) => ({
        name: entry.name,
        size: entry.size,
        open: () => browserSource(files, entry),
      })),
    );
  }

  const sourceSize = state.model ? formatBytes(state.model.size) : "";
  const importLabel = t({
    message: "导入模型",
    comment: "选择并打开一个本地三维模型文件。",
  });
  return (
    <AppPageLayout
      title={
        <Trans comment="本地 GLB、glTF、FBX 三维模型查看工具名称。">
          3D 模型
        </Trans>
      }
      maxWidth="max-w-none"
      scroll="page"
      adaptiveDensity
      bottomInset="scroll"
      contentClassName="flex flex-col gap-4"
      actions={
        <div className="flex items-center gap-2">
          {isTauriRuntime() ? (
            <Button
              id="model-library-trigger"
              variant="ghost"
              size="icon-sm"
              density="adaptive"
              aria-label={t({
                message: "模型库",
                comment: "本机保存的三维模型集合。",
              })}
              title={t({
                message: "模型库",
                comment: "本机保存的三维模型集合。",
              })}
              onClick={() => {
                setLibraryOpen(true);
                void library.refresh().catch(library.report);
              }}
            >
              <Library aria-hidden="true" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            density="adaptive"
            title={importLabel}
            aria-label={importLabel}
            onClick={() => void chooseModel()}
            disabled={!ready}
          >
            <FolderOpen aria-hidden="true" />
          </Button>
        </div>
      }
    >
      {isTauriRuntime() ? (
        <>
          <LibraryPanel
            controller={library}
            open={libraryOpen}
            onOpenChange={setLibraryOpen}
          />
          <LibraryStatus controller={library} />
        </>
      ) : null}
      <input
        ref={input}
        hidden
        type="file"
        multiple
        accept={modelFileAccept}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (files.length) openFiles(files);
        }}
      />
      <input
        ref={supplement}
        hidden
        type="file"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file)
            void session.attach(
              supplementKey.current,
              file,
              supplementId.current,
            );
        }}
      />
      <ImportStatus
        state={state}
        onCancel={() => session.cancel()}
        onAttach={(key) => void chooseDependency(key)}
      />
      {session.runtime ? (
        <MemoryWarning memory={session.runtime.memory} />
      ) : null}
      {state.model ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <span className="min-w-0 truncate font-medium">
            {state.model.name}
          </span>
          <Badge variant="secondary">{state.model.format}</Badge>
          {state.model.previewOnly ? (
            <Badge variant="outline">
              <Trans comment="模型仅在当前会话显示，不会保存到模型库或在退出后恢复。">
                仅本次预览
              </Trans>
            </Badge>
          ) : null}
          <span className="text-muted-foreground text-xs">
            <Trans comment="3D 模型入口文件的大小；sourceSize 是带单位的文件大小，不是内存估算。">
              源文件 {sourceSize}
            </Trans>
          </span>
        </div>
      ) : null}
      {!ready ? (
        <Alert>
          <AlertTitle>
            {context === "lost" ? (
              <Trans>3D 显示已中断</Trans>
            ) : (
              <Trans>无法显示 3D 内容</Trans>
            )}
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>
              <Trans>可以重试恢复图形显示，或返回其他工具。</Trans>
            </p>
            <Button
              density="adaptive"
              variant="outline"
              onClick={() => {
                if (context === "lost") session.runtime?.restoreContext();
                else setAttempt((value) => value + 1);
              }}
            >
              <Trans comment="重新初始化或恢复 WebGL 三维画布。">
                重试显示
              </Trans>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <div
        className={cn(
          "grid min-w-0 flex-1 gap-3",
          state.items.length > 0 &&
            "md:grid-cols-[minmax(0,1fr)_minmax(14rem,18rem)]",
        )}
      >
        <div
          className={cn(
            "bg-muted/30 relative flex min-h-72 flex-1 rounded-xl border md:min-h-96",
            hovering && "border-primary ring-primary ring-2",
          )}
          onDragOver={(event) => {
            if (isMobilePlatform()) return;
            event.preventDefault();
            setHovering(true);
          }}
          onDragLeave={() => setHovering(false)}
          onDrop={(event) => {
            event.preventDefault();
            setHovering(false);
            if (
              !nativeDesktop &&
              !isMobilePlatform() &&
              event.dataTransfer.files.length
            )
              openFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <div
            ref={canvas}
            role="img"
            tabIndex={state.model && ready ? 0 : -1}
            className="focus-visible:ring-ring absolute inset-0 size-full rounded-xl focus-visible:ring-2 focus-visible:outline-none"
            onDoubleClick={() => {
              if (ready && state.model) session.runtime?.fit();
            }}
            onKeyDown={(event) => {
              if (!ready || !state.model) return;
              const runtime = session.runtime;
              const mode = runtime?.tools.snapshot().mode;
              if (mode === "fly") return;
              if (mode === "measure" && event.key === "Enter") {
                runtime?.tools.measurement.pickAt();
                event.preventDefault();
                return;
              }
              if (event.key === "Escape" && runtime?.placing) {
                runtime.setPlacing(false);
                event.preventDefault();
                return;
              }
              switch (event.key) {
                case "ArrowLeft":
                  runtime?.step(-1, 0, event.shiftKey);
                  break;
                case "ArrowRight":
                  runtime?.step(1, 0, event.shiftKey);
                  break;
                case "ArrowUp":
                  runtime?.step(0, -1, event.shiftKey);
                  break;
                case "ArrowDown":
                  runtime?.step(0, 1, event.shiftKey);
                  break;
                case "+":
                case "=":
                  runtime?.zoom(0.8);
                  break;
                case "-":
                  runtime?.zoom(1.25);
                  break;
                case "Home":
                  runtime?.fit();
                  break;
                default:
                  return;
              }
              event.preventDefault();
            }}
            aria-label={t({
              message: "3D 模型画布",
              comment: "可聚焦的模型渲染区域，支持鼠标、触屏与键盘。",
            })}
          />
          {state.model && ready && session.runtime ? (
            <ViewGizmo runtime={session.runtime} />
          ) : null}
          <ViewerHelp open={help} onOpenChange={setHelp} />
          {state.model && ready && session.runtime ? (
            <CanvasControls
              runtime={session.runtime}
              interactive={!help && !inspectorOpen && !libraryOpen}
            />
          ) : null}
          {!state.model && ready ? (
            <Empty className="relative m-auto max-w-lg">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Box aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>
                  <Trans>打开一个 3D 模型</Trans>
                </EmptyTitle>
                <EmptyDescription>
                  <Trans>
                    支持 GLB、glTF 和
                    FBX。模型包含外置资源时，需同时提供依赖文件。
                  </Trans>
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button density="adaptive" onClick={() => void chooseModel()}>
                  <FolderOpen data-icon="inline-start" aria-hidden="true" />
                  <Trans comment="从设备选择本地三维模型文件。">选择模型</Trans>
                </Button>
                {!isMobilePlatform() ? (
                  <p className="text-muted-foreground text-xs">
                    <Trans>也可将模型文件拖到这里</Trans>
                  </p>
                ) : null}
              </EmptyContent>
            </Empty>
          ) : null}
          {state.model && !state.model.hasGeometry ? (
            <p
              role="status"
              className="text-muted-foreground relative m-auto p-4 text-sm"
            >
              <Trans>模型中没有可显示的几何体</Trans>
            </p>
          ) : null}
          {hovering ? (
            <div className="bg-background/90 pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl p-4 text-sm">
              <Trans>松开以打开模型</Trans>
            </div>
          ) : null}
        </div>
        {state.items.length > 0 && session.runtime ? (
          <>
            {session.runtime.animation ? (
              <AnimationBar
                key={`animation-${state.selected}`}
                animation={session.runtime.animation}
                disabled={
                  !ready || !session.runtime.models.current?.layer.visible
                }
              />
            ) : null}
            <WorkspaceInspector
              session={session}
              state={state}
              open={inspectorOpen}
              onOpenChange={setInspectorOpen}
            />
          </>
        ) : null}
      </div>
    </AppPageLayout>
  );
}
