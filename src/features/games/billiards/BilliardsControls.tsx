import { Trans, useLingui } from "@lingui/react/macro";
import type { CSSProperties, ReactNode } from "react";

import FixedSelect from "~/components/FixedSelect";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useDesktopLayout } from "~/lib/use-desktop-layout";

/** 杆法与力度只控制展示和输入参数，不拥有对局或球桌资源。 */
export function BilliardsControls({
  followDraw,
  onFollowDraw,
  power,
  interactive,
  action,
}: {
  followDraw: number;
  onFollowDraw: (value: number) => void;
  power: number;
  interactive: boolean;
  action?: ReactNode;
}) {
  const { t } = useLingui();
  const mobile = !useDesktopLayout();
  const options = [
    { value: "-0.7", label: t`拉杆` },
    { value: "0", label: t`中杆` },
    { value: "0.7", label: t`推杆` },
  ];
  return (
    <footer
      style={{ "--billiards-power": `${power}%` } as CSSProperties}
      className="billiards-controls flex min-w-0 shrink-0 items-center py-1"
    >
      <div className="billiards-control-content mx-auto flex w-full max-w-6xl min-w-0 items-center gap-2 px-3 md:px-4">
        <div className="billiards-power flex min-w-0 flex-1 items-center gap-2 text-xs">
          <span>
            <Trans>力度</Trans>
          </span>
          <div
            role="meter"
            aria-label={t`力度`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={power}
            className="bg-muted h-1 min-w-0 flex-1 overflow-hidden rounded-full"
          >
            <div
              className="bg-primary h-full rounded-full"
              style={{ width: `${power}%` }}
            />
          </div>
          <span className="text-muted-foreground w-9 text-right tabular-nums">
            {power}%
          </span>
        </div>
        {mobile ? (
          <Select
            disabled={!interactive}
            value={String(followDraw)}
            onValueChange={(value) => onFollowDraw(Number(value))}
          >
            <SelectTrigger
              density="adaptive"
              className="billiards-stroke shrink-0"
              aria-label={t`杆法`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
        {!mobile ? (
          <div className="billiards-stroke min-w-0 shrink-0">
            <FixedSelect
              disabled={!interactive}
              value={String(followDraw)}
              onValueChange={(value) => onFollowDraw(Number(value))}
            >
              <SelectTrigger aria-label={t`杆法`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {options.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      disabled={!interactive}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </FixedSelect>
          </div>
        ) : null}
        {action}
      </div>
    </footer>
  );
}
