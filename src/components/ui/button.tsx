import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";
import * as React from "react";

import { TOUCH_TARGET_CLASS } from "~/lib/touch";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-(--ui-icon-size)",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 [--button-visible-height:2rem] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs [--button-visible-height:1.5rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-(--ui-icon-size-xs)",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] [--button-visible-height:1.75rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-(--ui-icon-size-sm)",
        lg: "h-9 gap-1.5 px-2.5 [--button-visible-height:2.25rem] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8 [--button-visible-height:2rem]",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] [--button-visible-height:1.5rem] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-(--ui-icon-size-xs)",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] [--button-visible-height:1.75rem] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9 [--button-visible-height:2.25rem]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  fullWidth = false,
  density = "auto",
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    fullWidth?: boolean;
    /** auto 只在触控布局分离表面与热区；adaptive 保留既有的全平台 2rem 表面。 */
    density?: "auto" | "default" | "adaptive";
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-ui-control="button"
      data-variant={variant}
      data-size={size}
      data-density={density}
      className={cn(
        buttonVariants({ variant, size }),
        density === "auto" && [
          TOUCH_TARGET_CLASS,
          "ui-touch:ui-button-surface ui-touch:border-transparent ui-touch:bg-transparent ui-touch:shadow-none ui-touch:hover:bg-transparent ui-touch:aria-expanded:bg-transparent ui-touch:dark:border-transparent ui-touch:dark:bg-transparent ui-touch:dark:hover:bg-transparent relative",
        ],
        density === "adaptive" &&
          "ui-button-surface relative h-8 border-transparent bg-transparent shadow-none [--button-visible-height:2rem] hover:bg-transparent aria-expanded:bg-transparent dark:border-transparent dark:bg-transparent dark:hover:bg-transparent",
        fullWidth && "w-full md:w-auto",
        className,
      )}
      {...props}
    />
  );
}

export { Button, buttonVariants };
