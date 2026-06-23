import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/app/today")({
  beforeLoad: () => { throw redirect({ to: "/app/daily-log" }); },
});
