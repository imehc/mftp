import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState, useSyncExternalStore } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { describeError } from "~/lib/errors";

import type { ModelViewerRuntime } from "../runtime/viewer";
import {
  InspectionChoice,
  InspectionRange,
  InspectionToggle,
} from "./InspectionFields";

export function PreviewPanel({ runtime }: { runtime: ModelViewerRuntime }) {
  const { t } = useLingui();
  const state = useSyncExternalStore(
    runtime.tools.subscribe,
    runtime.tools.snapshot,
  );
  const [materialId, setMaterialId] = useState("");
  const [morphId, setMorphId] = useState("");
  const environment = useSyncExternalStore(
    runtime.environment.subscribe,
    runtime.environment.snapshot,
  );
  const input = useRef<HTMLInputElement>(null);
  const material =
    state.materials.find((m) => m.id === materialId) ?? state.materials[0];
  const morph = state.morphs.find((m) => m.id === morphId) ?? state.morphs[0];
  return (
    <FieldGroup>
      <InspectionToggle
        label={
          <Trans comment="将选中的三维模型显示为三角网格线框。">线框</Trans>
        }
        checked={state.wireframe}
        onChange={(v) => runtime.tools.display(v, state.normals)}
      />
      <InspectionToggle
        label={
          <Trans comment="用 RGB 颜色显示模型表面法线方向，兼容蒙皮和变形。">
            法线着色
          </Trans>
        }
        checked={state.normals}
        onChange={(v) => runtime.tools.display(state.wireframe, v)}
      />
      <InspectionToggle
        label={<Trans comment="显示模型投射和接收的实时阴影。">阴影</Trans>}
        checked={state.shadows}
        onChange={(v) => runtime.setShadows(v)}
      />
      <input
        ref={input}
        hidden
        type="file"
        accept=".hdr"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void runtime.environment.load(file);
        }}
      />
      <Button
        density="adaptive"
        variant="outline"
        disabled={environment.busy}
        onClick={() => input.current?.click()}
      >
        {environment.busy ? (
          <Trans>正在加载环境…</Trans>
        ) : (
          <Trans comment="选择本地 Radiance HDR 文件作为三维场景照明环境。">
            加载 HDR 环境
          </Trans>
        )}
      </Button>
      <p className="text-muted-foreground text-xs">
        <Trans>HDR · 最大 2048 × 1024 / 32 MiB</Trans>
      </p>
      {environment.name ? (
        <p className="truncate text-sm">{environment.name}</p>
      ) : null}
      {environment.name || environment.busy ? (
        <Button
          density="adaptive"
          variant="outline"
          onClick={() => runtime.environment.clear()}
        >
          <Trans comment="取消 HDR 加载或移除当前 HDR 照明，并释放资源。">
            清除环境
          </Trans>
        </Button>
      ) : null}
      {environment.error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {describeError(environment.error)}
          </AlertDescription>
        </Alert>
      ) : null}
      {material ? (
        <>
          <InspectionChoice
            label={t({
              message: "临时材质",
              comment: "选择要编辑的 PBR 材质副本，不写回源文件。",
            })}
            value={material.id}
            options={state.materials.map((m, i) => ({
              value: m.id,
              label: `${i + 1} · ${m.name}`,
            }))}
            onChange={setMaterialId}
          />
          <Field>
            <FieldLabel htmlFor="model-material-color">
              <Trans comment="PBR 材质基础色。">基础颜色</Trans>
            </FieldLabel>
            <Input
              id="model-material-color"
              type="color"
              value={material.color}
              onChange={(e) =>
                runtime.tools.editMaterial(material.id, {
                  color: e.target.value,
                })
              }
            />
          </Field>
          <InspectionRange
            label={t({
              message: "粗糙度",
              comment: "PBR 材质 roughness，0 光滑到 1 粗糙。",
            })}
            value={material.roughness}
            onChange={(v) =>
              runtime.tools.editMaterial(material.id, { roughness: v })
            }
          />
          <InspectionRange
            label={t({
              message: "金属度",
              comment: "PBR 材质 metalness，0 非金属到 1 金属。",
            })}
            value={material.metalness}
            onChange={(v) =>
              runtime.tools.editMaterial(material.id, { metalness: v })
            }
          />
          <InspectionRange
            label={t({
              message: "不透明度",
              comment: "材质 opacity，0 透明到 1 不透明。",
            })}
            value={material.opacity}
            onChange={(v) =>
              runtime.tools.editMaterial(material.id, { opacity: v })
            }
          />
        </>
      ) : (
        <p className="text-muted-foreground text-xs">
          <Trans>当前模型没有可编辑的 PBR 材质。</Trans>
        </p>
      )}
      {morph ? (
        <>
          <InspectionChoice
            label={t({
              message: "变形目标",
              comment: "模型 morph target，选择后调整当前权重。",
            })}
            value={morph.id}
            options={state.morphs.map((m) => ({ value: m.id, label: m.name }))}
            onChange={setMorphId}
          />
          <InspectionRange
            label={t({
              message: "变形权重",
              comment: "当前模型 morph target 权重；编辑时暂停动画。",
            })}
            value={morph.value}
            min={-1}
            max={2}
            onChange={(v) => runtime.tools.setMorph(morph.id, v)}
          />
        </>
      ) : (
        <p className="text-muted-foreground text-xs">
          <Trans>当前模型没有变形目标。</Trans>
        </p>
      )}
      <Button
        density="adaptive"
        variant="outline"
        onClick={() => runtime.tools.resetPreview()}
      >
        <Trans comment="恢复当前模型的材质、线框、法线显示和选择时的变形权重。">
          还原模型预览
        </Trans>
      </Button>
      <p className="text-muted-foreground text-xs">
        <Trans>仅影响预览，切换模型时还原。</Trans>
      </p>
    </FieldGroup>
  );
}
