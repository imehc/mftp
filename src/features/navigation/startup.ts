import { getToolEntry } from "~/features/home/entries";
import { TOOL_ROUTES } from "~/lib/module-metadata";

export function startupEntry({
  mobile,
  pathname,
  search,
  restore,
  lastTool,
}: {
  mobile: boolean;
  pathname: string;
  search: string;
  restore: boolean;
  lastTool: string | null;
}) {
  if (mobile || !restore || pathname !== "/" || search || !lastTool)
    return undefined;
  const route = TOOL_ROUTES.find((route) => route === lastTool);
  return route ? getToolEntry(route) : undefined;
}
