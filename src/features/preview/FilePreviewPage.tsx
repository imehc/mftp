import { useLingui } from "@lingui/react/macro";
import { useCanGoBack, useRouter } from "@tanstack/react-router";

import { previousAppLocation } from "~/features/navigation/back-history";
import { runMobileBackTransition } from "~/features/navigation/mobile-back-transition";
import type { PreviewKind } from "~/lib/preview-kind";

import PreviewScreen from "./PreviewScreen";

export default function FilePreviewPage({
  name,
  kind,
  url,
}: {
  name: string;
  kind: PreviewKind;
  url?: string;
}) {
  const { t } = useLingui();
  const router = useRouter(),
    canGoBack = useCanGoBack();
  return (
    <PreviewScreen
      name={name}
      kind={kind}
      url={url ?? null}
      error={!url ? t`没有可预览的文件，请返回来源重新打开` : null}
      onBack={(event) => {
        runMobileBackTransition(
          router,
          previousAppLocation(router.history)?.href ?? "/",
          () => {
            if (canGoBack) router.history.back();
            else return router.navigate({ to: "/" });
          },
          (event?.detail ?? 0) > 0,
        );
      }}
    />
  );
}
