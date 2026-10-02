import { useEffect, useId, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { ChevronDown, Check } from "lucide-react";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
} from "~/components/ui/input-group";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "~/components/ui/popover";

/** 可自由输入的历史候选；复用现有输入、浮层和按钮，不写入候选历史。 */
export default function CandidateInput({
  id,
  value,
  candidates,
  onChange,
  disabled,
  maxLength,
  required = true,
}: {
  id: string;
  value: string;
  candidates: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
  maxLength?: number;
  required?: boolean;
}) {
  const { t } = useLingui();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const options = candidates.filter((candidate) =>
    candidate.toLocaleLowerCase().includes(value.toLocaleLowerCase()),
  );
  useEffect(() => {
    if (open && active >= 0)
      document
        .getElementById(`${listId}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);
  function choose(candidate: string) {
    onChange(candidate);
    setOpen(false);
    setActive(-1);
    input.current?.focus();
  }
  return (
    <Popover
      open={open && !disabled && options.length > 0}
      onOpenChange={setOpen}
    >
      <PopoverAnchor asChild>
        <InputGroup>
          <InputGroupInput
            ref={input}
            id={id}
            value={value}
            disabled={disabled}
            maxLength={maxLength}
            required={required}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open && options.length > 0}
            aria-controls={listId}
            aria-activedescendant={
              open && active >= 0 && active < options.length
                ? `${listId}-${active}`
                : undefined
            }
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => {
              onChange(event.target.value);
              setActive(-1);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                if (!options.length) return;
                event.preventDefault();
                setOpen(true);
                setActive((previous) =>
                  event.key === "ArrowDown"
                    ? (previous + 1) % options.length
                    : previous <= 0
                      ? options.length - 1
                      : previous - 1,
                );
              } else if (event.key === "Enter" && open && options[active]) {
                event.preventDefault();
                choose(options[active]);
              } else if (event.key === "Escape" && open) {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
              } else if (event.key === "Tab") setOpen(false);
            }}
          />
          <InputGroupAddon align="inline-end">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled || !options.length}
              aria-label={t`选择已保存的候选`}
              onClick={() => {
                setActive(-1);
                setOpen((previous) => !previous);
                input.current?.focus();
              }}
            >
              <ChevronDown />
            </Button>
          </InputGroupAddon>
        </InputGroup>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="ui-density-adaptive w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] gap-0 p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (input.current?.parentElement?.contains(event.target as Node))
            event.preventDefault();
        }}
      >
        <div
          id={listId}
          role="listbox"
          aria-labelledby={id}
          className="max-h-48 overflow-y-auto"
        >
          {options.map((candidate, index) => (
            <Button
              key={candidate}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={active === index}
              variant={active === index ? "secondary" : "ghost"}
              className="w-full justify-between"
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(candidate)}
            >
              <span className="truncate">{candidate}</span>
              {candidate === value ? <Check data-icon="inline-end" /> : null}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
