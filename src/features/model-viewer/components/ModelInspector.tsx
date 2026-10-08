import { Trans, useLingui } from "@lingui/react/macro";
import { Info, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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

import type {
  InspectionViewState,
  ModelInspection,
} from "../domain/inspection";
import type { ModelViewerRuntime } from "../runtime/viewer";
import { ResourceDetails } from "./ResourceDetails";
import { SceneTree } from "./SceneTree";

function ModelInformation({ inspection }: { inspection: ModelInspection }) {
  const { t, i18n } = useLingui();
  const counts = inspection.counts;
  const rows = [
    [
      t({ message: "顶点数", comment: "模型唯一几何体中的顶点总数。" }),
      counts.vertices,
    ],
    [
      t({
        message: "三角面数",
        comment: "模型唯一三角形几何体中的面数，不含线和点。",
      }),
      counts.triangles,
    ],
    [
      t({ message: "材质数", comment: "当前模型场景中的唯一材质数量。" }),
      counts.materials,
    ],
    [
      t({ message: "纹理数", comment: "当前模型场景中的唯一纹理对象数量。" }),
      counts.textures,
    ],
    [
      t({ message: "动画数", comment: "当前模型的动画片段数量。" }),
      counts.animations,
    ],
    [
      t({ message: "几何体数", comment: "模型场景中的唯一几何体资源数量。" }),
      counts.geometries,
    ],
    [
      t({
        message: "绘制实例数",
        comment: "场景中网格、线和点的实例总数，包含 GPU 实例化副本。",
      }),
      counts.instances,
    ],
  ] as const;
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-medium">
        <Trans comment="三维模型统计信息标题。">模型信息</Trans>
      </h3>
      <dl className="flex flex-col divide-y">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-start justify-between gap-4 py-3 text-xs"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right tabular-nums">
              {value === null ? <Trans>未知</Trans> : i18n.number(value)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground text-xs leading-relaxed">
        <Trans>
          按当前场景的唯一几何体、材质和纹理对象统计，实例另列。顶点与三角面按完整几何体计算，不随可见性或绘制范围变化；线和点不计入三角面。
        </Trans>
      </p>
      <p className="text-muted-foreground text-xs">
        <Trans>源文件大小不等于内存占用。</Trans>
      </p>
    </div>
  );
}

export function ModelInspector({
  inspection,
  runtime,
  open,
  onOpenChange,
  embedded = false,
  cache,
}: {
  inspection: ModelInspection;
  runtime: ModelViewerRuntime;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  embedded?: boolean;
  cache?: InspectionViewState;
}) {
  const { t } = useLingui();
  const wide = useDesktopLayout();
  const [tab, setTab] = useState(cache?.tab ?? "info");
  const [expanded, setExpanded] = useState(
    () => cache?.expanded ?? new Set([inspection.root]),
  );
  const [selected, setSelected] = useState(cache?.selected ?? inspection.root);
  const [active, setActive] = useState<string | null>(cache?.active ?? null);
  const treeOffset = useRef(cache?.offset ?? 0);
  useEffect(
    () => () => {
      // 浮层或外层标签卸载后保留每个模型的检查位置；删除模型时随所有者释放。
      if (cache)
        Object.assign(cache, {
          tab,
          expanded,
          selected,
          active,
          offset: treeOffset.current,
        });
    },
    [cache, tab, expanded, selected, active],
  );
  useEffect(() => {
    if (wide && open) onOpenChange(false);
  }, [wide, open, onOpenChange]);
  const node = inspection.nodes[selected];
  const content = (
    <Tabs value={tab} onValueChange={setTab} className="min-w-0 gap-4">
      <TabsList
        density="adaptive"
        className="w-full"
        aria-label={t({
          message: "模型检查面板",
          comment: "模型信息、场景和材质标签组。",
        })}
      >
        <TabsTrigger value="info">
          <Trans comment="模型检查区的统计信息标签。">信息</Trans>
        </TabsTrigger>
        <TabsTrigger value="scene">
          <Trans comment="模型检查区的场景树标签。">场景</Trans>
        </TabsTrigger>
        <TabsTrigger value="materials">
          <Trans comment="模型检查区的材质与纹理标签。">材质</Trans>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="info">
        <ModelInformation inspection={inspection} />
      </TabsContent>
      <TabsContent value="scene" className="flex flex-col gap-3">
        <SceneTree
          inspection={inspection}
          expanded={expanded}
          selected={selected}
          onExpanded={setExpanded}
          onSelected={setSelected}
          initialOffset={() => treeOffset.current}
          onOffset={(offset) => {
            treeOffset.current = offset;
          }}
        />
        <div className="flex min-w-0 flex-col gap-2 text-xs">
          <h3 className="font-medium">
            <Trans comment="场景树当前选中节点的资源信息。">节点详情</Trans>
          </h3>
          <p className="break-all">
            {node.name || (
              <Trans comment="场景树节点缺少名称。">未命名节点</Trans>
            )}{" "}
            · {node.type}
          </p>
          {node.materials.length ? (
            node.materials.map((id) => {
              const index = inspection.materials.findIndex(
                (material) => material.id === id,
              );
              const material = inspection.materials[index];
              const number = index + 1;
              return (
                <Button
                  key={id}
                  density="adaptive"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => {
                    setActive(id);
                    setTab("materials");
                  }}
                >
                  <span className="truncate">
                    {material.name ||
                      t({
                        message: `材质 ${number}`,
                        comment: "无名称的模型材质，number 从 1 开始。",
                      })}
                  </span>
                </Button>
              );
            })
          ) : (
            <p className="text-muted-foreground">
              <Trans>此节点未引用材质</Trans>
            </p>
          )}
        </div>
      </TabsContent>
      <TabsContent value="materials">
        <ResourceDetails
          inspection={inspection}
          runtime={runtime}
          active={active}
          onActive={setActive}
        />
      </TabsContent>
    </Tabs>
  );
  if (embedded) return content;
  return (
    <aside
      className="order-first min-w-0 md:order-last md:col-start-2 md:row-span-2 md:row-start-1"
      aria-label={t({
        message: "模型检查面板",
        comment: "模型信息、场景和材质标签组。",
      })}
    >
      {wide ? (
        <div className="max-h-[min(48rem,80dvh)] overflow-auto rounded-xl border p-3">
          {content}
        </div>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogTrigger asChild>
            <Button density="adaptive" variant="outline">
              <Info data-icon="inline-start" aria-hidden="true" />
              <Trans comment="打开模型信息、场景树和材质检查浮层。">
                信息与场景
              </Trans>
            </Button>
          </DialogTrigger>
          <DialogContent
            placement="responsive-sheet"
            className="flex max-h-[85dvh] flex-col overflow-hidden"
            showCloseButton={false}
          >
            <DialogHeader className="shrink-0 pr-10">
              <DialogTitle>
                <Trans comment="三维模型检查浮层标题。">模型详情</Trans>
              </DialogTitle>
              <DialogDescription>
                <Trans>查看模型统计、场景节点及材质纹理。</Trans>
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
                  message: "关闭模型详情",
                  comment: "关闭三维模型检查浮层。",
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
