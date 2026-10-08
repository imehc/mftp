import { Trans, useLingui } from "@lingui/react/macro";
import { Settings2 } from "lucide-react";
import { useId } from "react";

import { Button } from "~/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Slider } from "~/components/ui/slider";

interface Props {
  showLabel?: boolean;
  fontSize: number;
  lineHeight: number;
  onFontSizeChange: (size: number) => void;
  onLineHeightChange: (height: number) => void;
}

export default function ReadingSettingsPopover(props: Props) {
  const { t } = useLingui();
  const titleId = useId();
  const fontId = useId();
  const lineId = useId();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={props.showLabel ? "outline" : "ghost"}
          size={props.showLabel ? "sm" : "icon-sm"}
          density="adaptive"
          aria-label={t`阅读设置`}
          title={t`阅读设置`}
        >
          <Settings2 />
          {props.showLabel ? <Trans>阅读设置</Trans> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        aria-labelledby={titleId}
        className="ui-density-adaptive max-h-(--radix-popover-content-available-height) w-64 max-w-[calc(100vw-2rem)] overflow-y-auto font-sans"
      >
        <PopoverTitle id={titleId}>
          <Trans>阅读设置</Trans>
        </PopoverTitle>
        <FieldGroup density="compact">
          <Field>
            <FieldLabel id={fontId} className="flex justify-between">
              <Trans>字号</Trans>
              <span>{props.fontSize}</span>
            </FieldLabel>
            <Slider
              value={[props.fontSize]}
              min={14}
              max={26}
              step={1}
              onValueChange={([size]) => props.onFontSizeChange(size)}
              aria-labelledby={fontId}
            />
          </Field>
          <Field>
            <FieldLabel id={lineId} className="flex justify-between">
              <Trans>行距</Trans>
              <span>{props.lineHeight.toFixed(1)}</span>
            </FieldLabel>
            <Slider
              value={[props.lineHeight]}
              min={1.5}
              max={2.6}
              step={0.1}
              onValueChange={([height]) => props.onLineHeightChange(height)}
              aria-labelledby={lineId}
            />
          </Field>
        </FieldGroup>
      </PopoverContent>
    </Popover>
  );
}
