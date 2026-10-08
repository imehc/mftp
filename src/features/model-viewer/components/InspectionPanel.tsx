import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs";
import type { ModelViewerRuntime } from "../runtime/viewer";
import { NavigationPanel } from "./NavigationPanel";
import { PreviewPanel } from "./PreviewPanel";
import { DiagnosticsPanel } from "./DiagnosticsPanel";

export function InspectionPanel({
  runtime,
  onCanvas,
}: {
  runtime: ModelViewerRuntime;
  onCanvas: () => void;
}) {
  const { t } = useLingui();
  const [tab, setTab] = useState("navigation");
  return (
    <Tabs value={tab} onValueChange={setTab} className="min-w-0 gap-4">
      <TabsList
        density="adaptive"
        className="w-full"
        aria-label={t({
          message: "深度检查工具",
          comment: "相机导航、预览编辑、测量诊断的标签组。",
        })}
      >
        <TabsTrigger value="navigation">
          <Trans comment="自由相机与视角管理标签。">导航</Trans>
        </TabsTrigger>
        <TabsTrigger value="preview">
          <Trans comment="模型显示效果、材质与变形编辑标签。">预览</Trans>
        </TabsTrigger>
        <TabsTrigger value="diagnostics">
          <Trans comment="距离、尺寸与网格诊断标签。">诊断</Trans>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="navigation">
        <NavigationPanel runtime={runtime} onCanvas={onCanvas} />
      </TabsContent>
      <TabsContent value="preview">
        <PreviewPanel runtime={runtime} />
      </TabsContent>
      <TabsContent value="diagnostics">
        <DiagnosticsPanel
          runtime={runtime}
          onMeasure={() => {
            runtime.setMode("measure");
            onCanvas();
          }}
        />
      </TabsContent>
    </Tabs>
  );
}
