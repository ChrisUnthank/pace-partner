import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useMyAthlete } from "@/lib/use-auth";
import { VitalsPanel } from "@/components/vitals-panel";

export const Route = createFileRoute("/_authenticated/app/vitals")({
  component: VitalsPage,
});

function VitalsPage() {
  const { data: athlete, isLoading } = useMyAthlete();
  if (isLoading) return <AppShell><p>Loading…</p></AppShell>;
  if (!athlete) return (
    <AppShell>
      <p className="text-sm">No athlete profile linked. Visit <Link to="/app/profile" className="underline">Profile</Link> to set up.</p>
    </AppShell>
  );
  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Vitals</h1>
        <VitalsPanel athleteId={athlete.id} />
      </div>
    </AppShell>
  );
}