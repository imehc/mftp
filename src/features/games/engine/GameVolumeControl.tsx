import { useLingui } from "@lingui/react/macro";
import { Volume2, VolumeX } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Slider } from "~/components/ui/slider";
import { useSettingsStore } from "~/store/settings";
export function GameVolumeControl() {
  const { t } = useLingui();
  const volume = useSettingsStore((state) => state.gamesVolume);
  const setVolume = useSettingsStore((state) => state.setGamesVolume);
  const label = t`游戏音量`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} title={label}>
          {volume > 0 ? <Volume2 /> : <VolumeX />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground shrink-0"
            aria-label={label}
            title={label}
            onClick={() => setVolume(volume > 0 ? 0 : 0.7)}
          >
            {volume > 0 ? (
              <Volume2 className="size-4" />
            ) : (
              <VolumeX className="size-4" />
            )}
          </button>
          <Slider
            value={[Math.round(volume * 100)]}
            min={0}
            max={100}
            step={5}
            aria-label={label}
            onValueChange={(values: number[]) => setVolume(values[0] / 100)}
          />
          <span className="text-muted-foreground w-8 shrink-0 text-right text-xs tabular-nums">
            {Math.round(volume * 100)}
          </span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
