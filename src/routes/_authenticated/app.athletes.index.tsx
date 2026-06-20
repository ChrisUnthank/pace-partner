import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/app/athletes/")({
  component: AthletesPage,
});

function AthletesPage() {
  const { user } = useAuthUser();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [event, setEvent] = useState("");
  const [email, setEmail] = useState("");

  const { data: roster } = useQuery({
    queryKey: ["roster", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("coach_athletes")
        .select("athlete_id, athletes(*)")
        .eq("coach_user_id", user!.id);
      return data ?? [];
    },
  });

  async function addAthlete() {
    if (!name) { toast.error("Name required"); return; }
    const { data: ath, error } = await supabase.from("athletes").insert({
      name, primary_event: event || null, created_by: user!.id,
    }).select().single();
    if (error || !ath) { toast.error(error?.message ?? "Failed"); return; }
    await supabase.from("coach_athletes").insert({ coach_user_id: user!.id, athlete_id: ath.id });
    if (email) {
      await supabase.from("athlete_invites").insert({
        coach_user_id: user!.id, athlete_id: ath.id, email,
      });
    }
    setName(""); setEvent(""); setEmail("");
    toast.success("Athlete added");
    qc.invalidateQueries({ queryKey: ["roster"] });
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <h1 className="text-2xl font-bold">Athletes</h1>
        <Card>
          <CardHeader>
            <CardTitle>Add an athlete</CardTitle>
            <CardDescription>Creates the athlete in your roster. Email is optional — they can link later by signing in.</CardDescription>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-3 gap-3">
            <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label>Primary event</Label><Input placeholder="800m" value={event} onChange={(e) => setEvent(e.target.value)} /></div>
            <div><Label>Invite email (optional)</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="sm:col-span-3"><Button onClick={addAthlete}>Add</Button></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Roster</CardTitle></CardHeader>
          <CardContent className="p-0">
            {!roster || roster.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No athletes yet.</p>
            ) : (
              <div className="divide-y">
                {roster.map((r: any) => (
                  <Link key={r.athlete_id} to="/app/athletes/$athleteId" params={{ athleteId: r.athlete_id }}
                    className="flex justify-between items-center px-4 py-3 hover:bg-accent/40">
                    <div>
                      <div className="font-medium">{r.athletes?.name}</div>
                      <div className="text-xs text-muted-foreground">{r.athletes?.primary_event ?? "—"}</div>
                    </div>
                    <span className="text-xs text-muted-foreground">{r.athletes?.user_id ? "Linked" : "Unlinked"}</span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}