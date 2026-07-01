import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/app/races/$raceId")({
  component: RaceLayout,
});

function RaceLayout() {
  return <Outlet />;
}
