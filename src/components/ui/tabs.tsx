import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";

import { cn } from "cn";

const TabsDensityContext = React.createContext<"default" | "adaptive">(
  "default",
);

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
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & {
  density?: "default" | "adaptive";
}) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-density={density}
      className={cn(
        "text-muted-foreground inline-flex w-fit items-center justify-center rounded-lg",
        density === "default" ? "bg-muted h-8 p-[3px]" : "px-[3px]",
        className,
      )}
      {...props}
    >
      <TabsDensityContext.Provider value={density}>
        {children}
      </TabsDensityContext.Provider>
    </TabsPrimitive.List>
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const density = React.useContext(TabsDensityContext);
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "text-foreground focus-visible:ring-ring/50 inline-flex h-full flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        density === "default" &&
          "data-[state=active]:bg-background data-[state=active]:shadow-sm",
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
