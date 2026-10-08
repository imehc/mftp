import { Trans, useLingui } from "@lingui/react/macro";
import { Layers, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useDesktopLayout } from "~/lib/use-desktop-layout";

import type { ViewerSession, ViewerState } from "../runtime/session";
import { InspectionPanel } from "./InspectionPanel";
import { MemoryPanel } from "./MemoryPanel";
import { ModelInspector } from "./ModelInspector";
import { ModelList } from "./ModelList";

export function WorkspaceInspector({
  session,
  state,
  open,
  onOpenChange,
}: {
  session: ViewerSession;
  state: ViewerState;
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const { t } = useLingui();
  const wide = useDesktopLayout();
  const [tab, setTab] = useState("models");
  useEffect(() => {
    if (wide && open) onOpenChange(false);
  }, [wide, open, onOpenChange]);
  const runtime = session.runtime;
  if (!runtime) return null;
  const content = (
    <Tabs value={tab} onValueChange={setTab} className="min-w-0 gap-4">
      <TabsList
        density="adaptive"
        className="w-full"
        aria-label={t({
          message: "查看器面板",
          comment: "模型列表、当前模型检查和内存面板标签组。",
        })}
      >
        <TabsTrigger value="models">
          <Trans comment="三维查看器的多模型列表标签。">模型</Trans>
        </TabsTrigger>
        <TabsTrigger value="details">
          <Trans comment="当前选中模型的信息、场景和材质标签。">检查</Trans>
        </TabsTrigger>
        <TabsTrigger value="memory">
          <Trans comment="模型内存估算和历史曲线标签。">内存</Trans>
        </TabsTrigger>
        <TabsTrigger value="tools" disabled={!state.model}>
          <Trans comment="三维查看器的自由相机、预览编辑与诊断工具。">
            工具
          </Trans>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="models">
        <ModelList session={session} state={state} />
      </TabsContent>
      <TabsContent value="details">
        {state.inspection ? (
          <ModelInspector
            key={state.inspection.root}
            embedded
            cache={runtime.models.current?.inspectionView}
            inspection={state.inspection}
            runtime={runtime}
            open={false}
            onOpenChange={() => {}}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            <Trans>选择一个已加载模型以查看详情。</Trans>
          </p>
        )}
      </TabsContent>
      <TabsContent value="memory">
        <MemoryPanel memory={runtime.memory} selected={state.selected} />
      </TabsContent>
      <TabsContent value="tools">
        <InspectionPanel
          runtime={runtime}
          onCanvas={() => {
            onOpenChange(false);
            runtime.focusCanvas();
          }}
        />
      </TabsContent>
    </Tabs>
  );
  return (
    <aside className="order-first min-w-0 md:order-last md:col-start-2 md:row-span-2 md:row-start-1">
      {wide ? (
        <div className="max-h-[min(48rem,80dvh)] overflow-auto rounded-xl border p-3">
          {content}
        </div>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogTrigger asChild>
            <Button density="adaptive" variant="outline">
              <Layers data-icon="inline-start" aria-hidden="true" />
              <Trans comment="打开多模型管理、详情和内存的共享浮层。">
                模型与检查
              </Trans>
            </Button>
          </DialogTrigger>
          <DialogContent
            placement="responsive-sheet"
            showCloseButton={false}
            className="ui-density-adaptive flex max-h-[85dvh] flex-col overflow-hidden"
          >
            <DialogHeader className="shrink-0 pr-10">
              <DialogTitle>
                <Trans comment="多模型查看器共享检查浮层标题。">
                  模型与检查
                </Trans>
              </DialogTitle>
              <DialogDescription>
                <Trans>管理模型、调整位置并检查资源。</Trans>
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 overflow-y-auto">{content}</div>
            <DialogClose asChild>
              <Button
                density="adaptive"
                variant="ghost"
                size="icon-sm"
                className="absolute top-2 right-2"
                aria-label={t({
                  message: "关闭模型面板",
                  comment: "关闭多模型查看器的检查浮层。",
                })}
              >
                <X aria-hidden="true" />
              </Button>
            </DialogClose>
          </DialogContent>
        </Dialog>
      )}
    </aside>
  );
}
