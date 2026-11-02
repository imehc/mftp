import { commands, type MobileNavigationConfig } from "~/bindings";
import { voidCommand } from "~/lib/ipc-result";

export const mobileNavigationConfigure = (input: MobileNavigationConfig) =>
  voidCommand(commands.mobileNavigationConfigure(input));
