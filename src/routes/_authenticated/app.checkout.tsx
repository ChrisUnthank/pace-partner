import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/app/checkout")({
  beforeLoad: () => { throw redirect({ to: "/app/daily-log" }); },
});
