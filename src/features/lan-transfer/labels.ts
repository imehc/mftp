import { msg } from "@lingui/core/macro";
import { translate } from "~/i18n/translate";
export function lanPermissionLabel(value?: string | null) {
  if (value === "readOnly") return translate(msg`只读`);
  if (value === "uploadOnly") return translate(msg`仅上传`);
  return translate(msg`读写`);
}
