import { Trans } from "@lingui/react/macro";

export function BilliardsShotHelp() {
  return (
    <p className="app-description">
      <Trans>
        在母球后方拖动可瞄准并蓄力，松手击球。也可保持当前方向，拖动力度条后松手击球；拖回零力度或按
        Esc 取消。键盘方向键调整力度，回车或空格击球。
      </Trans>
    </p>
  );
}
