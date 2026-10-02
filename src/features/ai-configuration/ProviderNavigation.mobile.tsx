import { Trans, useLingui } from "@lingui/react/macro";
import { Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { AI_LIMITS, type ProviderNavigationProps } from "./types";

export default function ProviderNavigationMobile({
  view,
  selectedId,
  onSelect,
  onAdd,
  disabled,
}: ProviderNavigationProps) {
  const { t } = useLingui();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Select value={selectedId} onValueChange={onSelect} disabled={disabled}>
        <SelectTrigger
          density="adaptive"
          className="min-w-0 flex-1"
          aria-label={t`查看服务地址`}
        >
          <SelectValue placeholder={t`选择服务地址`} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {view.providers.map((provider) => (
              <SelectItem key={provider.id} value={provider.id}>
                {provider.name}
                {provider.id === view.activeProviderId ? (
                  <>
                    {" "}
                    · <Trans>当前</Trans>
                  </>
                ) : null}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button
        density="adaptive"
        variant="ghost"
        size="icon"
        aria-label={t`添加地址`}
        disabled={disabled || view.providers.length >= AI_LIMITS.providers}
        onClick={onAdd}
      >
        <Plus />
      </Button>
    </div>
  );
}
