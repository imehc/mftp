import { Trans, useLingui } from "@lingui/react/macro";
import { RotateCcw, RotateCw } from "lucide-react";

import { Button } from "~/components/ui/button";

import { GameSetupSelect } from "../engine/GameSetupSelect";
import { faceMove } from "./engine";
import { FACE_LABELS } from "./labels";
import { type CubeMove, type CubeOrder, type Face, FACES } from "./types";

export function MagicCubeControls({
  order,
  face,
  depth,
  onFace,
  onDepth,
  onTurn,
  disabled,
}: {
  order: CubeOrder;
  face: Face;
  depth: number;
  onFace(face: Face): void;
  onDepth(depth: number): void;
  onTurn(move: CubeMove): void;
  disabled: boolean;
}) {
  const { t } = useLingui();
  return (
    <div className="flex flex-col gap-3">
      <GameSetupSelect
        density="adaptive"
        wrapValue={false}
        label={<Trans comment="精确转动魔方时选择固定坐标的面">面</Trans>}
        value={face}
        onChange={(value) => onFace(value as Face)}
        options={FACES.map((value) => ({
          value,
          label: t(FACE_LABELS[value]),
        }))}
      />
      <GameSetupSelect
        density="adaptive"
        wrapValue={false}
        label={<Trans comment="从所选魔方面向内数的层号">层</Trans>}
        value={String(depth)}
        onChange={(value) => onDepth(Number(value))}
        options={Array.from({ length: order }, (_, i) => {
          const layer = i + 1;
          return {
            value: String(layer),
            label: t({
              message: `第 ${layer} 层`,
              comment: "魔方从所选面向内数的层号，1 是最外层",
            }),
          };
        })}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          disabled={disabled}
          aria-label={t({
            message: "逆时针转动",
            comment: "正对所选魔方面，将选中层逆时针转 90 度",
          })}
          onClick={() => onTurn(faceMove(face, depth, false, order))}
        >
          <RotateCcw />
        </Button>
        <Button
          variant="outline"
          size="icon"
          disabled={disabled}
          aria-label={t({
            message: "顺时针转动",
            comment: "正对所选魔方面，将选中层顺时针转 90 度",
          })}
          onClick={() => onTurn(faceMove(face, depth, true, order))}
        >
          <RotateCw />
        </Button>
        <Button
          variant="outline"
          disabled={disabled}
          aria-label={t`转动 180 度`}
          onClick={() =>
            onTurn({ ...faceMove(face, depth, true, order), turns: 2 })
          }
        >
          180°
        </Button>
      </div>
      <p className="app-description">
        <Trans>方向以正对所选面为准，层号从该面向内数。</Trans>
      </p>
    </div>
  );
}
