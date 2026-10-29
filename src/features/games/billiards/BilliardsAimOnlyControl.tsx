import { Trans } from "@lingui/react/macro";
import { useId } from "react";

import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";

import { useBilliardsPreferences } from "./preferences";

export function BilliardsAimOnlyControl() {
  const id = useId();
  const aimOnly = useBilliardsPreferences((state) => state.aimOnly);
  const setAimOnly = useBilliardsPreferences((state) => state.setAimOnly);
  return (
    <div className="flex items-center justify-between gap-3 px-2 py-1.5">
      <Label htmlFor={id}>
        <Trans comment="台球更多菜单开关：桌上拖动只瞄准，松手不击球；力度条仍可击球">
          仅瞄准
        </Trans>
      </Label>
      <Switch id={id} checked={aimOnly} onCheckedChange={setAimOnly} />
    </div>
  );
}
