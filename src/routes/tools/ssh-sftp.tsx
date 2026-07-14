import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import SshSftpTool from "~/features/ssh-sftp/SshSftpTool";
import { useSettingsStore } from "~/store/settings";

function SshSftpRoute() {
  const setLastTool = useSettingsStore((s) => s.setLastTool);

  useEffect(() => {
    setLastTool("ssh-sftp");
  }, [setLastTool]);

  return <SshSftpTool />;
}

export const Route = createFileRoute("/tools/ssh-sftp")({
  component: SshSftpRoute,
});
