import { useLingui } from "@lingui/react/macro";

import { ballDefinition } from "./ball-definitions";
import { isRed } from "./snooker-equipment";

export function useSnookerBallName() {
  const { t } = useLingui();
  return (id: number) => {
    if (isRed(id))
      return t({
        message: "红球",
        comment: "斯诺克球名，1分；多个红球外观相同",
      });
    switch (id) {
      case 0:
        return t({ message: "母球", comment: "斯诺克白色击球球，无分值" });
      case 2:
        return t({ message: "黄球", comment: "斯诺克彩球，2分" });
      case 3:
        return t({ message: "绿球", comment: "斯诺克彩球，3分" });
      case 4:
        return t({ message: "棕球", comment: "斯诺克彩球，4分" });
      case 5:
        return t({ message: "蓝球", comment: "斯诺克彩球，5分" });
      case 6:
        return t({ message: "粉球", comment: "斯诺克彩球，6分" });
      default:
        return t({ message: "黑球", comment: "斯诺克彩球，7分" });
    }
  };
}

export function SnookerBall({ id }: { id: number }) {
  const name = useSnookerBallName();
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="inline-block size-4 shrink-0 rounded-full ring-1 ring-black/25 dark:ring-white/30"
        style={{ backgroundColor: ballDefinition(id, "snooker").color }}
      />
      {name(id)}
    </span>
  );
}
