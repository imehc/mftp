import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/tools/image-compress")({
  beforeLoad: () => {
    throw redirect({
      to: "/tools/media-compress",
      search: { mode: "image" },
      replace: true,
    });
  },
});
