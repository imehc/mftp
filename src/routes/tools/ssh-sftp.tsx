import { createFileRoute } from "@tanstack/react-router";

import { useRememberTool } from "~/features/navigation/use-remember-tool";
import SshSftpTool from "~/features/ssh-sftp/SshSftpTool";

function SshSftpRoute() {
  useRememberTool("ssh-sftp");

  return <SshSftpTool />;
}

export const Route = createFileRoute("/tools/ssh-sftp")({
  component: SshSftpRoute,
});
