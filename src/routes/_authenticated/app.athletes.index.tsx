import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyRawRoles } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { CalendarDays } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/athletes/")({
  component: AthletesPage,
});

function AthletesPage() {
  const { user } = useAuthUser();
  const { data: rawRoles = [] } = useMyRawRoles();
  const isManager = rawRoles.includes("manager");
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [event, setEvent] = useState("");
  const [email, setEmail] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const { data: roster } = useQuery({
    queryKey: ["roster", user?.id, isManager],
    enabled: !!user,
    queryFn: async () => {
      if (isManager) {
        const { data } = await supabase
          .from("athletes")
          .select("*, athlete_invites:athlete_invites!athlete_invites_athlete_id_fkey(token, accepted_at, email)")
          .order("name");
        return (data ?? []).map((a: any) => ({ athlete_id: a.id, athletes: a, athlete_invites: a.athlete_invites }));
      }
      const { data } = await supabase
        .from("coach_athletes")
        .select("athlete_id, athletes(*), athlete_invites:athlete_invites!athlete_invites_athlete_id_fkey(token, accepted_at, email)")
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
      const { data: inv } = await supabase.from("athlete_invites").insert({
        coach_user_id: user!.id, athlete_id: ath.id, email,
      }).select("token").single();
      if (inv?.token) setInviteLink(`${window.location.origin}/claim/${inv.token}`);
    }
    setName(""); setEvent(""); setEmail("");
    toast.success("Athlete added");
    qc.invalidateQueries({ queryKey: ["roster"] });
  }

  async function copyExistingInvite(athleteId: string, existing: any) {
    let token: string | undefined = existing?.[0]?.token && !existing?.[0]?.accepted_at ? existing[0].token : undefined;
    if (!token) {
      const inviteEmail = window.prompt("Email to send the invite to:");
      if (!inviteEmail) return;
      const { data, error } = await supabase.from("athlete_invites").insert({
        coach_user_id: user!.id, athlete_id: athleteId, email: inviteEmail,
      }).select("token").single();
      if (error || !data) { toast.error(error?.message ?? "Failed"); return; }
      token = data.token;
      qc.invalidateQueries({ queryKey: ["roster"] });
    }
    const link = `${window.location.origin}/claim/${token}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Invite link copied");
    } catch {
      setInviteLink(link);
    }
  }

  async function copyLink() {
    if (!inviteLink) return;
    try { await navigator.clipboard.writeText(inviteLink); toast.success("Copied"); }
    catch { toast.error("Copy failed — select the link manually"); }
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
                  <div key={r.athlete_id} className="flex justify-between items-center px-4 py-3 hover:bg-accent/40 gap-3">
                    <Link to="/app/athletes/$athleteId" params={{ athleteId: r.athlete_id }} className="flex-1 min-w-0">
                      <div className="font-medium truncate">{r.athletes?.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{r.athletes?.primary_event ?? "—"}</div>
                    </Link>
                    <div className="flex items-center gap-2 shrink-0">
                      <Link to="/app/sessions/calendar" search={{ athleteId: r.athlete_id } as any}>
                        <Button size="icon" variant="ghost" title="View calendar"><CalendarDays className="h-4 w-4" /></Button>
                      </Link>
                      {r.athletes?.user_id ? (
                        <Badge variant="secondary">Linked</Badge>
                      ) : (
                        <>
                          <Badge variant="outline">Invite pending</Badge>
                          <Button size="sm" variant="ghost" onClick={() => copyExistingInvite(r.athlete_id, r.athlete_invites)}>
                            {r.athlete_invites?.length ? "Copy invite link" : "Generate invite link"}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!inviteLink} onOpenChange={(o) => !o && setInviteLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite link ready</DialogTitle>
            <DialogDescription>Send this link to your athlete. It's valid for 30 days and works once.</DialogDescription>
          </DialogHeader>
          <Input readOnly value={inviteLink ?? ""} onFocus={(e) => e.currentTarget.select()} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteLink(null)}>Close</Button>
            <Button onClick={copyLink}>Copy link</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}