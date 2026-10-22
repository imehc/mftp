import { cn } from "cn";
import { Tabs as TabsPrimitive } from "radix-ui";
import * as React from "react";

import { TOUCH_TARGET_CLASS } from "~/lib/touch";

const TabsDensityContext = React.createContext<"default" | "adaptive">(
  "default",
);
const TabsVariantContext = React.createContext<"default" | "line">("default");

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function TabsList({
  className,
  density = "default",
  variant = "default",
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & {
  density?: "default" | "adaptive";
  variant?: "default" | "line";
}) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-density={density}
      data-variant={variant}
      className={cn(
        "text-muted-foreground inline-flex w-fit items-center justify-center rounded-lg",
        variant === "line"
          ? "gap-1 rounded-none bg-transparent p-0"
          : density === "default"
            ? "bg-muted h-8 p-[3px]"
            : "px-[3px]",
        variant === "line" && density === "default" && "h-8",
        className,
      )}
      {...props}
    >
      <TabsDensityContext.Provider value={density}>
        <TabsVariantContext.Provider value={variant}>
          {children}
        </TabsVariantContext.Provider>
      </TabsDensityContext.Provider>
    </TabsPrimitive.List>
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const density = React.useContext(TabsDensityContext);
  const variant = React.useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "text-foreground focus-visible:ring-ring/50 inline-flex h-full flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        variant === "default" &&
          density === "default" &&
          "data-[state=active]:bg-background data-[state=active]:shadow-sm",
        variant === "line" &&
          "text-muted-foreground data-[state=active]:border-b-primary data-[state=active]:text-foreground rounded-none border-0 border-b-2 border-b-transparent px-3",
        density === "adaptive" && TOUCH_TARGET_CLASS,
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
