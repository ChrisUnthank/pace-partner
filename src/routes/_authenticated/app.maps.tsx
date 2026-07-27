import { createFileRoute } from "@tanstack/react-router";
import { ComingSoonPage } from "@/components/coming-soon-page";
import { Map, Route, MapPinned, Mountain, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/maps")({
  component: MapsRoutesPage,
});

function MapsRoutesPage() {
  return (
    <ComingSoonPage
      icon={Map}
      eyebrow="Training"
      title="Maps & Routes"
      description="A shared library of training routes and locations — save the loops your squad actually runs, see them on a map, and attach them straight to planned sessions instead of describing them in a text field every time."
      features={[
        {
          icon: Route,
          title: "Route library",
          description: "Save named routes with distance and elevation, built by drawing on the map or importing a GPX/FIT file.",
        },
        {
          icon: MapPinned,
          title: "Attach to sessions",
          description: "Pick a saved route when building a session or plan template, so athletes see exactly where a run happens.",
        },
        {
          icon: Mountain,
          title: "Elevation profile",
          description: "Auto-generated climb profile per route, matching the same chart style already used on Session Analysis.",
        },
        {
          icon: Users,
          title: "Squad favourites",
          description: "Surface the routes a training group uses most, and let a coach pin go-to routes for race prep or long runs.",
        },
      ]}
    />
  );
}
