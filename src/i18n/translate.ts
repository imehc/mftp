import { i18n } from "@lingui/core";
import type { MessageDescriptor } from "@lingui/core";

export function translate(message: MessageDescriptor) {
  return i18n._(message);
}
