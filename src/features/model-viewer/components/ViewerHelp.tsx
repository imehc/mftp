import { HelpCircle } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";

export function ViewerHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          density="adaptive"
          variant="ghost"
          size="icon-sm"
          className="absolute bottom-2 left-2"
          aria-label={t({
            message: "操作帮助",
            comment: "打开三维视角操作说明。",
          })}
          title={t({ message: "操作帮助", comment: "打开三维视角操作说明。" })}
        >
          <HelpCircle aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent placement="responsive-sheet">
        <DialogHeader>
          <DialogTitle>
            <Trans>查看模型</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>模型和依赖文件仅在当前设备处理。</Trans>
          </DialogDescription>
        </DialogHeader>
        <p>
          <Trans>
            鼠标拖动旋转，右键拖动平移，滚轮缩放。触屏单指旋转，双指平移或缩放。
          </Trans>
        </p>
        <p>
          <Trans>
            点击 XYZ 坐标轴切换视角，双击画布或坐标轴可重新显示整个模型。
          </Trans>
        </p>
        <p>
          <Trans>
            画布聚焦后，可用方向键旋转、Shift 加方向键平移、加减键缩放、Home
            适配视图。坐标轴聚焦后，可按 X、Y、Z 切换方向，Shift 切换反方向。
          </Trans>
        </p>
        <p>
          <Trans>
            外置 glTF 需要对应的 bin
            和纹理文件。缺少资源时，请按完整路径逐项补选。
          </Trans>
        </p>
        <p>
          <Trans>
            FBX 仅在当前会话预览，不保存到模型库。支持 PNG、JPEG、WebP 和 BMP
            贴图；缺少外置贴图时可补选文件。
          </Trans>
        </p>
        <p>
          <Trans>
            FBX 文件上限为 64 MiB；复杂模型、过大的贴图或超过 30
            秒的解析会停止，请简化后重试。
          </Trans>
        </p>
        <p>
          <Trans>
            自由移动：WASD 移动，Q/E 升降，Shift 加速，拖动画布转向，Esc
            退出。触屏可点按摇杆方向移动，或拖动摇杆连续移动，并使用升降按钮。
          </Trans>
        </p>
        <p>
          <Trans>
            测量时点击同一模型的两个表面点；也可用方向键调整视角，按 Enter
            选取画布中心点。
          </Trans>
        </p>
      </DialogContent>
    </Dialog>
  );
}
