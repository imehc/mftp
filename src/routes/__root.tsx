import { useEffect } from "react";
import { Outlet, createRootRoute, useNavigate } from "@tanstack/react-router";
import { useHostsStore } from "~/store/hosts";
import { useSettingsStore } from "~/store/settings";

const START_ROUTE_RESOLVED_KEY = "mftp-start-route-resolved";

function RootLayout() {
  const navigate = useNavigate();
  const loadAll = useHostsStore((s) => s.loadAll);
  const lastTool = useSettingsStore((s) => s.lastTool);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (sessionStorage.getItem(START_ROUTE_RESOLVED_KEY)) return;
    sessionStorage.setItem(START_ROUTE_RESOLVED_KEY, "1");
    if (window.location.pathname !== "/" || !lastTool) return;
    const toolPaths = {
      "ssh-sftp": "/tools/ssh-sftp",
      "lan-transfer": "/tools/lan-transfer",
      crypto: "/tools/crypto",
    } as const;
    void navigate({ to: toolPaths[lastTool], replace: true });
  }, [lastTool, navigate]);

  return <Outlet />;
}

export const Route = createRootRoute({
  component: RootLayout,
});
