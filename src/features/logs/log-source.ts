import { msg } from "@lingui/core/macro";

import { translate } from "~/i18n/translate";

const sources = {
  ai: "HTTP / AI",
  http: "HTTP",
  ssh: "SSH",
  sftp: "SFTP",
  bt: "BT",
};

export function logSource(source: string, localize = translate): string {
  if (source in sources) return sources[source as keyof typeof sources];
  if (source === "lan") return localize(msg`局域网`);
  if (source === "games") return localize(msg`游戏`);
  if (source === "poetry") return localize(msg`诗词库`);
  return source;
}
