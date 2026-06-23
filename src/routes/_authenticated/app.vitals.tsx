import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/app/vitals")({
  beforeLoad: () => { throw redirect({ to: "/app/daily-log" }); },
});
