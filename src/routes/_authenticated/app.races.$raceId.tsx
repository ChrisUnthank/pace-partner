import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/app/races/$raceId")({
  component: RaceLayout,
});

function RaceLayout() {
  return <Outlet />;
}

