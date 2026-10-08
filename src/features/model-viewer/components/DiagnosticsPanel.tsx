import { Trans, useLingui } from "@lingui/react/macro";
import { useState, useSyncExternalStore } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { describeError } from "~/lib/errors";

import { type Unit, unitFactor } from "../inspection/tools";
import type { ModelViewerRuntime } from "../runtime/viewer";
import { InspectionChoice } from "./InspectionFields";

export function DiagnosticsPanel({
  runtime,
  onMeasure,
}: {
  runtime: ModelViewerRuntime;
  onMeasure: () => void;
}) {
  const { t, i18n } = useLingui();
  const tools = useSyncExternalStore(
    runtime.tools.subscribe,
    runtime.tools.snapshot,
  );
  const state = useSyncExternalStore(
    runtime.tools.diagnostics.subscribe,
    runtime.tools.diagnostics.snapshot,
  );
  const [tolerance, setTolerance] = useState("0.00001");
  const [meshIndex, setMeshIndex] = useState("0");
  const value = Number(tolerance);
  const valid =
    tolerance.trim() !== "" &&
    Number.isFinite(value) &&
    value >= 1e-9 &&
    value <= 1;
  const format = (metres: number) =>
    `${new Intl.NumberFormat(i18n.locale, { maximumSignificantDigits: 7 }).format(metres * unitFactor[tools.unit])} ${tools.unit}`;
  const mesh = state.topology?.[Number(meshIndex)] ?? state.topology?.[0];
  const distance = tools.distance === null ? "" : format(tools.distance);
  const version = state.validation?.validatorVersion;

  function run(kind: "validation" | "topology" | "dimensions") {
    const entry = runtime.models.current;
    if (entry) void runtime.tools.diagnostics.run(entry, kind, value);
  }

  const rows = mesh
    ? [
        [
          t({ message: "三角形", comment: "拓扑分析中的三角形总数。" }),
          mesh.triangles,
        ],
        [
          t({ message: "开放边", comment: "仅属于一个有效三角形的网格边数。" }),
          mesh.openEdges,
        ],
        [
          t({
            message: "非流形边",
            comment: "属于两个以上有效三角形的网格边数。",
          }),
          mesh.nonManifoldEdges,
        ],
        [
          t({
            message: "绕序冲突",
            comment: "相邻三角形共享边的方向相同，法线朝向可能不一致。",
          }),
          mesh.windingConflicts,
        ],
        [
          t({
            message: "退化三角形",
            comment: "焊接后顶点重复或面积过小的三角形数。",
          }),
          mesh.degenerate,
        ],
        [
          t({
            message: "法线方向不一致",
            comment: "至少一个顶点法线与几何法线方向相反的三角形数。",
          }),
          mesh.normalsAvailable
            ? mesh.opposedNormals
            : t({
                message: "不适用",
                comment: "模型没有可准确比较的静态顶点法线。",
              }),
        ],
        [
          t({
            message: "可能朝内的壳体",
            comment: "封闭且绕序一致、但有向体积为负的连通壳体数。",
          }),
          mesh.inwardShells,
        ],
      ]
    : [];
  return (
    <FieldGroup>
      <InspectionChoice
        label={t({
          message: "显示单位",
          comment: "距离与包围盒尺寸的显示单位，不缩放模型。",
        })}
        value={tools.unit}
        onChange={(v) => runtime.tools.setUnit(v as Unit)}
        options={["m", "cm", "mm", "ft"].map((v) => ({ value: v, label: v }))}
      />
      <Button density="adaptive" variant="outline" onClick={onMeasure}>
        <Trans comment="进入画布拾取两点并测量距离。">开始两点测量</Trans>
      </Button>
      <p className="text-sm" role="status">
        {tools.distance === null ? (
          <Trans>在同一模型表面选取两点。</Trans>
        ) : (
          <Trans comment="distance 是带单位的三维两点距离。">
            距离：{distance}
          </Trans>
        )}
      </p>
      <Button
        density="adaptive"
        variant="outline"
        disabled={!!state.busy}
        onClick={() => run("dimensions")}
      >
        <Trans comment="按当前姿态重新计算源模型的世界轴对齐包围盒尺寸。">
          计算包围盒尺寸
        </Trans>
      </Button>
      {state.dimensions ? (
        <dl className="grid grid-cols-[auto_1fr] gap-2 text-sm">
          {state.dimensions.map((n, i) => (
            <div className="contents" key={i}>
              <dt>{["X", "Y", "Z"][i]}</dt>
              <dd className="text-right tabular-nums">{format(n)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="text-muted-foreground text-xs">
        <Trans>按模型原始尺寸测量。姿态变化后需重新选点。</Trans>
      </p>
      <Field data-invalid={!valid}>
        <FieldLabel htmlFor="model-weld-tolerance">
          <Trans comment="源世界坐标中合并近点的距离阈值，以米计。">
            焊接容差（米）
          </Trans>
        </FieldLabel>
        <Input
          id="model-weld-tolerance"
          type="number"
          min={1e-9}
          max={1}
          step="any"
          value={tolerance}
          aria-invalid={!valid}
          onChange={(e) => setTolerance(e.target.value)}
        />
      </Field>
      <Button
        density="adaptive"
        variant="outline"
        disabled={!!state.busy || !valid}
        onClick={() => run("topology")}
      >
        <Trans comment="在后台分析当前模型各网格实例的拓扑缺陷。">
          分析网格拓扑
        </Trans>
      </Button>
      <details className="text-muted-foreground text-xs">
        <summary className="min-h-11 cursor-pointer py-3">
          <Trans comment="展开网格分析的计量范围和容量限制。">分析说明</Trans>
        </summary>
        <Trans>
          每个网格实例单独分析当前姿态，不跨网格焊接。上限为 20 万顶点、10
          万三角形、1000 个实例；分析会暂停当前模型动画。
        </Trans>
      </details>
      {state.topology ? (
        <>
          {state.topology.length ? (
            <InspectionChoice
              label={t({
                message: "网格实例",
                comment: "选择查看某个网格实例的拓扑报告。",
              })}
              value={String(Math.max(0, state.topology.indexOf(mesh!)))}
              options={state.topology.map((m, i) => ({
                value: String(i),
                label: `${i + 1} · ${m.name}`,
              }))}
              onChange={setMeshIndex}
            />
          ) : (
            <p className="text-sm">
              <Trans>没有可分析的三角网格。</Trans>
            </p>
          )}
          <dl className="flex flex-col gap-2 text-xs">
            {rows.map(([label, count]) => (
              <div key={label} className="flex justify-between gap-2">
                <dt>{label}</dt>
                <dd className="tabular-nums">{count}</dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground text-xs">
            <Trans>
              开放网格无法确定内外。朝内壳体与法线不一致仅为检查提示，特殊美术法线可能是有意设置。退化三角形不参与边统计。
            </Trans>
          </p>
        </>
      ) : null}
      <Button
        density="adaptive"
        variant="outline"
        disabled={
          !!state.busy || !runtime.models.current?.handle.validationSource
        }
        onClick={() => run("validation")}
      >
        <Trans comment="使用本地 Khronos 验证器检查原始 glTF/GLB 及已授权依赖。">
          验证 glTF 规范
        </Trans>
      </Button>
      <p className="text-muted-foreground text-xs">
        <Trans>离线检查原始文件；部分扩展可能不受支持。</Trans>
      </p>
      {state.busy ? (
        <div className="flex items-center gap-2" role="status">
          <Spinner aria-hidden="true" />
          <span className="text-sm">
            <Trans>正在检查…</Trans>
          </span>
          <Button
            density="adaptive"
            variant="outline"
            onClick={runtime.tools.diagnostics.cancel}
          >
            <Trans comment="停止模型诊断后台任务。">取消检查</Trans>
          </Button>
        </div>
      ) : null}
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{describeError(state.error)}</AlertDescription>
        </Alert>
      ) : null}
      {state.validation ? (
        <div className="flex min-w-0 flex-col gap-3 text-xs">
          <p>
            <Trans comment="version 是 Khronos glTF 规范验证器版本。">
              验证器版本：{version}
            </Trans>
          </p>
          <dl className="grid grid-cols-2 gap-2">
            <dt>
              <Trans comment="glTF 规范报告中的错误数量。">错误</Trans>
            </dt>
            <dd>{state.validation.issues.numErrors}</dd>
            <dt>
              <Trans comment="glTF 规范报告中的警告数量。">警告</Trans>
            </dt>
            <dd>{state.validation.issues.numWarnings}</dd>
            <dt>
              <Trans comment="glTF 规范报告中的信息与建议数量合计。">
                信息与建议
              </Trans>
            </dt>
            <dd>
              {state.validation.issues.numInfos +
                state.validation.issues.numHints}
            </dd>
          </dl>
          {state.validation.issues.truncated ? (
            <p>
              <Trans>报告超过 200 条，以下结果已截断。</Trans>
            </p>
          ) : null}
          <p className="text-muted-foreground">
            <Trans>以下保留验证器的原始诊断、代码和文件位置。</Trans>
          </p>
          <ol className="flex min-w-0 flex-col gap-3">
            {state.validation.issues.messages.map((issue, i) => (
              <li
                className="min-w-0 [overflow-wrap:anywhere] break-words"
                key={i}
              >
                <p className="font-mono">{issue.code}</p>
                <p>{issue.message}</p>
                {issue.pointer ? (
                  <p className="text-muted-foreground font-mono">
                    {issue.pointer}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </FieldGroup>
  );
}
