import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";

import type {
  MaterialInfo,
  ModelInspection,
  TextureInfo,
} from "../domain/inspection";
import type { ModelViewerRuntime } from "../runtime/viewer";

function TextureDetails({
  texture,
  runtime,
}: {
  texture: TextureInfo;
  runtime: ModelViewerRuntime;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      setPreview(runtime.previewTexture(texture.id)),
    );
    return () => cancelAnimationFrame(frame);
  }, [runtime, texture.id]);
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border p-3">
      <p className="text-sm break-all">
        {texture.name || (
          <Trans comment="三维模型纹理缺少名称。">未命名纹理</Trans>
        )}
      </p>
      {preview ? (
        <img
          src={preview}
          alt={texture.name || ""}
          className="max-h-32 max-w-full self-start rounded-md object-contain"
        />
      ) : (
        <p className="text-muted-foreground text-xs">
          <Trans>此纹理暂无法生成缩略图</Trans>
        </p>
      )}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
        <dt>
          <Trans comment="模型纹理图像的像素尺寸。">分辨率</Trans>
        </dt>
        <dd>
          {texture.width !== null && texture.height !== null ? (
            `${texture.width} × ${texture.height}`
          ) : (
            <Trans>未知</Trans>
          )}
        </dd>
        <dt>
          <Trans comment="解码后模型纹理的像素格式，不是源文件扩展名。">
            像素格式
          </Trans>
        </dt>
        <dd className="break-all">{texture.format || <Trans>未知</Trans>}</dd>
        <dt>
          <Trans comment="模型纹理在材质中的用途。">用途</Trans>
        </dt>
        <dd className="break-words">
          {texture.slots.map((slot) => (
            <div key={slot}>
              <TextureSlot slot={slot} />
            </div>
          ))}
        </dd>
      </dl>
    </div>
  );
}

function TextureSlot({ slot }: { slot: string }) {
  switch (slot) {
    case "map":
      return <Trans comment="模型材质的基础颜色纹理用途。">基础颜色</Trans>;
    case "normalMap":
      return <Trans comment="模型材质的法线纹理用途。">法线</Trans>;
    case "metalnessMap":
      return <Trans comment="模型材质的金属度纹理用途。">金属度</Trans>;
    case "roughnessMap":
      return <Trans comment="模型材质的粗糙度纹理用途。">粗糙度</Trans>;
    case "emissiveMap":
      return <Trans comment="模型材质的自发光纹理用途。">自发光</Trans>;
    case "aoMap":
      return <Trans comment="模型材质的环境遮蔽纹理用途。">环境遮蔽</Trans>;
    case "alphaMap":
      return <Trans comment="模型材质的透明度纹理用途。">透明度</Trans>;
    default:
      return <>{slot}</>;
  }
}

export function MaterialDetails({
  material,
  inspection,
  runtime,
}: {
  material: MaterialInfo;
  inspection: ModelInspection;
  runtime: ModelViewerRuntime;
}) {
  const { i18n } = useLingui();
  const format = (value: number | null) =>
    value === null ? (
      <Trans>未知</Trans>
    ) : (
      i18n.number(value, { maximumFractionDigits: 3 })
    );
  return (
    <div className="flex flex-col gap-3 pb-3">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
        <dt>
          <Trans comment="三维模型材质类型。">类型</Trans>
        </dt>
        <dd className="break-all">{material.type}</dd>
        <dt>
          <Trans comment="模型材质的基础颜色属性。">基础颜色</Trans>
        </dt>
        <dd>{material.color ?? <Trans>未知</Trans>}</dd>
        <dt>
          <Trans comment="模型材质的不透明度，0 为透明，1 为不透明。">
            不透明度
          </Trans>
        </dt>
        <dd>{format(material.opacity)}</dd>
        <dt>
          <Trans comment="模型材质的金属度属性。">金属度</Trans>
        </dt>
        <dd>{format(material.metalness)}</dd>
        <dt>
          <Trans comment="模型材质的粗糙度属性。">粗糙度</Trans>
        </dt>
        <dd>{format(material.roughness)}</dd>
        <dt>
          <Trans comment="模型材质是否渲染三角面的两侧。">双面渲染</Trans>
        </dt>
        <dd>{material.doubleSided ? <Trans>是</Trans> : <Trans>否</Trans>}</dd>
      </dl>
      <p className="text-muted-foreground text-xs">
        <Trans comment="本材质引用的纹理及下方对应预览。">关联纹理</Trans>
      </p>
      {material.textures.length ? (
        material.textures.map(({ id, slot }) => {
          const texture = inspection.textures.find((value) => value.id === id);
          return (
            <p key={slot} className="text-xs break-all">
              <TextureSlot slot={slot} /> ·{" "}
              {texture?.name || (
                <Trans comment="三维模型纹理缺少名称。">未命名纹理</Trans>
              )}
            </p>
          );
        })
      ) : (
        <p className="text-muted-foreground text-xs">
          <Trans>此材质未引用纹理</Trans>
        </p>
      )}
      {inspection.textures
        .filter((texture) =>
          material.textures.some((entry) => entry.id === texture.id),
        )
        .map((texture) => (
          <TextureDetails
            key={texture.id}
            texture={texture}
            runtime={runtime}
          />
        ))}
    </div>
  );
}

export function ResourceDetails({
  inspection,
  runtime,
  active,
  onActive,
}: {
  inspection: ModelInspection;
  runtime: ModelViewerRuntime;
  active: string | null;
  onActive: (id: string | null) => void;
}) {
  const { t } = useLingui();
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">
        <Trans comment="三维模型的唯一材质列表。">材质列表</Trans>
      </h3>
      {!inspection.materials.length ? (
        <p className="text-muted-foreground text-xs">
          <Trans>此场景没有材质</Trans>
        </p>
      ) : (
        inspection.materials.map((material, index) => {
          const number = index + 1;
          const name =
            material.name ||
            t({
              message: `材质 ${number}`,
              comment: "无名称的模型材质，number 从 1 开始。",
            });
          const open = active === material.id;
          return (
            <div key={material.id} className="flex min-w-0 flex-col gap-2">
              <Button
                variant="ghost"
                density="adaptive"
                className="w-full justify-start"
                aria-expanded={open}
                onClick={() => onActive(open ? null : material.id)}
              >
                {open ? (
                  <ChevronDown data-icon="inline-start" aria-hidden="true" />
                ) : (
                  <ChevronRight data-icon="inline-start" aria-hidden="true" />
                )}
                <span className="truncate" title={name}>
                  {number}. {name}
                </span>
              </Button>
              {open ? (
                <MaterialDetails
                  material={material}
                  inspection={inspection}
                  runtime={runtime}
                />
              ) : null}
            </div>
          );
        })
      )}
      <h3 className="text-sm font-medium">
        <Trans comment="三维模型按唯一纹理去重后的列表。">纹理列表</Trans>
      </h3>
      {!inspection.textures.length ? (
        <p className="text-muted-foreground text-xs">
          <Trans>此场景没有纹理</Trans>
        </p>
      ) : (
        inspection.textures.map((texture, index) => {
          const open = active === texture.id;
          const number = index + 1;
          const name =
            texture.name ||
            t({
              message: `纹理 ${number}`,
              comment: "无名称的模型纹理，number 从 1 开始。",
            });
          return (
            <div key={texture.id} className="flex min-w-0 flex-col gap-2">
              <Button
                variant="ghost"
                density="adaptive"
                className="w-full justify-start"
                aria-expanded={open}
                onClick={() => onActive(open ? null : texture.id)}
              >
                {open ? (
                  <ChevronDown data-icon="inline-start" aria-hidden="true" />
                ) : (
                  <ChevronRight data-icon="inline-start" aria-hidden="true" />
                )}
                <span className="truncate" title={name}>
                  {number}. {name}
                </span>
              </Button>
              {open ? (
                <TextureDetails texture={texture} runtime={runtime} />
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}
