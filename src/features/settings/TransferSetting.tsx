import { useLingui } from "@lingui/react/macro";
import { FolderTree } from "lucide-react";

import { useSettingsStore } from "~/store/settings";
import { useTransfersStore } from "~/store/transfers";

import SettingChoice from "./SettingChoice";

export default function TransferSetting() {
  const { t } = useLingui();
  const mode = useSettingsStore((state) => state.directoryTransferMode);
  const setMode = useSettingsStore((state) => state.setDirectoryTransferMode);
  const running = useTransfersStore((state) =>
    state.transfers.some((item) => item.status === "running"),
  );
  return (
    <SettingChoice
      id="settings-transfer"
      icon={FolderTree}
      title={t`文件夹传输`}
      fixed
      value={mode}
      disabled={running}
      description={running ? t`传输进行中，暂不可修改。` : undefined}
      onChange={(value) => {
        if (value === "archive" || value === "direct") setMode(value);
      }}
      options={[
        {
          value: "archive",
          label: t({ message: "压缩包", comment: "文件夹传输模式：打包传输" }),
        },
        {
          value: "direct",
          label: t({
            message: "直连",
            comment: "文件夹传输模式：逐文件直接传输",
          }),
        },
      ]}
    />
  );
}
