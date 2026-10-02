import { useCanGoBack, useRouter } from "@tanstack/react-router";
import { useLingui } from "@lingui/react/macro";
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
      onBack={() => {
        if (canGoBack) router.history.back();
        else void router.navigate({ to: "/" });
      }}
    />
  );
}
