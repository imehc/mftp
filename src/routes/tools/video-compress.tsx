import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/tools/video-compress")({
  beforeLoad: () => {
    throw redirect({
      to: "/tools/media-compress",
      search: { mode: "video" },
      replace: true,
    });
  },
});
