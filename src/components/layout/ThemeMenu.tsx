import { Monitor, Moon, Palette, Settings, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";

const themes = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
] as const;

export default function ThemeMenu() {
  const { theme = "system", setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "h-9 w-full justify-start gap-2 rounded-md px-2 text-left",
            "aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground",
          )}
          title="设置"
        >
          <Settings data-icon="inline-start" />
          <span className="min-w-0 flex-1 truncate">设置</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette />
            主题
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
              {themes.map((item) => {
                const Icon = item.icon;
                return (
                  <DropdownMenuRadioItem key={item.value} value={item.value}>
                    <Icon />
                    {item.label}
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
