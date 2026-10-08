import { useLingui } from "@lingui/react/macro";
import { Eye, EyeOff } from "lucide-react";
import * as React from "react";

import { Button } from "~/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "~/components/ui/input-group";

function PasswordInput({ className, ...props }: React.ComponentProps<"input">) {
  const { t } = useLingui();
  const [visible, setVisible] = React.useState(false);
  const toggleLabel = visible ? t`隐藏密码` : t`显示密码`;
  return (
    <InputGroup className={className}>
      <InputGroupInput {...props} type={visible ? "text" : "password"} />
      <InputGroupAddon align="inline-end">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-7"
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff /> : <Eye />}
        </Button>
      </InputGroupAddon>
    </InputGroup>
  );
}

export { PasswordInput };
