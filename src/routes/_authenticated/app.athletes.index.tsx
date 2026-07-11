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
import { AthleteSummaryPanel } from "@/components/athlete-summary-panel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TIMEZONE_OPTIONS, guessLocalTimezone } from "@/lib/timezones";

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
  // Defaults to the coach's own browser-detected timezone — a reasonable
  // guess for a new athlete, and adjustable right here before saving.
  // Previously there was no way to set this at all, so every new athlete
  // silently landed on the DB default (UTC), which threw off session-time
  // classification (Morning/Afternoon/Evening) for every session they
  // ever uploaded until someone corrected it directly in the database.
  const [timezone, setTimezone] = useState(guessLocalTimezone());
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [joinEmail, setJoinEmail] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinMessage, setJoinMessage] = useState("");
  // Clicking an athlete in the roster opens a quick-look summary panel
  // instead of navigating straight to their full page — lets a coach flip
  // through several athletes without losing their place in the roster.
  // "Full view" on the panel goes to the same /app/athletes/$athleteId
  // page the roster used to link to directly. The panel itself
  // (AthleteSummaryPanel) is shared with the Home dashboard.
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(null);

  const { data: roster } = useQuery({
    queryKey: ["roster", user?.id, isManager],
    enabled: !!user,
    queryFn: async () => {
      if (isManager) {
        const { data, error } = await supabase
          .from("athletes")
          .select("*, athlete_invites(token, accepted_at, email)")
          .order("name");
        if (error) { toast.error(error.message); return []; }
        return (data ?? []).map((a: any) => ({ athlete_id: a.id, athletes: a, athlete_invites: a.athlete_invites }));
      }
      const { data, error } = await supabase
        .from("coach_athletes")
        .select("athlete_id, athletes(*, athlete_invites(token, accepted_at, email))")
        .eq("coach_user_id", user!.id);
      if (error) { toast.error(error.message); return []; }
      return (data ?? []).map((r: any) => ({
        athlete_id: r.athlete_id,
        athletes: r.athletes,
        athlete_invites: r.athletes?.athlete_invites ?? [],
      }));
    },
  });

  const selectedAthlete = roster?.find((r: any) => r.athlete_id === selectedAthleteId)?.athletes ?? null;

  async function addAthlete() {
    if (!name) { toast.error("Name required"); return; }
    const { data: ath, error } = await supabase.from("athletes").insert({
      name, primary_event: event || null, created_by: user!.id, timezone,
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

  async function sendJoinRequest() {
    if (!joinEmail) { toast.error("Email required"); return; }
    const { data, error } = await (supabase.rpc as any)("request_athlete_join_by_email", {
      _email: joinEmail,
      _athlete_name: joinName || null,
      _message: joinMessage || null,
    });
    if (error) { toast.error(error.message); return; }
    const result = data as any;
    if (!result?.ok) {
      if (result?.error === "no_account") toast.error("No account uses that email yet — use the invite-link flow above instead.");
      else if (result?.error === "not_coach") toast.error("You need a coach role to send join requests.");
      else toast.error(result?.error ?? "Failed");
      return;
    }
    if (result.already_linked) toast.success("Athlete is already on your roster");
    else toast.success("Join request sent");
    setJoinEmail(""); setJoinName(""); setJoinMessage("");
    qc.invalidateQueries({ queryKey: ["roster"] });
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-6xl">
        <h1 className="text-2xl font-bold">Athletes</h1>

        {/* Roster leads the page — it's what a coach actually wants on
            arrival. The add/invite forms are secondary, occasional actions,
            so they now sit below rather than pushing the roster down. */}
        <div className="grid gap-6 lg:grid-cols-[1fr_380px] items-start">
          <div className="space-y-6 min-w-0">
            <Card>
              <CardHeader><CardTitle>Roster</CardTitle></CardHeader>
              <CardContent className="p-0">
                {!roster || roster.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">No athletes yet — add one below.</p>
                ) : (
                  <div className="divide-y">
                    {roster.map((r: any) => (
                      <div
                        key={r.athlete_id}
                        className={`flex justify-between items-center px-4 py-3 hover:bg-accent/40 gap-3 ${
                          selectedAthleteId === r.athlete_id ? "bg-accent/60" : ""
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedAthleteId(r.athlete_id)}
                          className="flex-1 min-w-0 text-left"
                        >
                          <div className="font-medium truncate">{r.athletes?.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{r.athletes?.primary_event ?? "—"}</div>
                        </button>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button asChild size="icon" variant="ghost" title="View calendar">
                            <Link to="/app/sessions/calendar" search={{ athleteId: r.athlete_id } as any}>
                              <CalendarDays className="h-4 w-4" />
                            </Link>
                          </Button>
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

            <Card>
              <CardHeader>
                <CardTitle>Add an athlete</CardTitle>
                <CardDescription>Creates the athlete in your roster. Email is optional — they can link later by signing in.</CardDescription>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-3 gap-3">
                <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div><Label>Primary event</Label><Input placeholder="800m" value={event} onChange={(e) => setEvent(e.target.value)} /></div>
                <div><Label>Invite email (optional)</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                <div>
                  <Label>Time zone</Label>
                  <Select value={timezone} onValueChange={setTimezone}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIMEZONE_OPTIONS.map((z) => (
                        <SelectItem key={z.value} value={z.value}>{z.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-3"><Button onClick={addAthlete}>Add</Button></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Invite an existing account</CardTitle>
                <CardDescription>If the athlete already has a Strider account, send them a join request — they'll see it on their Profile.</CardDescription>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-3 gap-3">
                <div><Label>Account email</Label><Input type="email" value={joinEmail} onChange={(e) => setJoinEmail(e.target.value)} /></div>
                <div><Label>Display name (optional)</Label><Input value={joinName} onChange={(e) => setJoinName(e.target.value)} /></div>
                <div><Label>Message (optional)</Label><Input value={joinMessage} onChange={(e) => setJoinMessage(e.target.value)} /></div>
                <div className="sm:col-span-3"><Button variant="outline" onClick={sendJoinRequest}>Send join request</Button></div>
              </CardContent>
            </Card>
          </div>

          {/* Summary panel — an in-flow sticky column, not a fixed overlay,
              so it can never slide over the header strip regardless of
              header height. Sticks within the viewport as the roster/forms
              column scrolls past it. Only takes up space once an athlete
              is actually selected. */}
          {selectedAthlete && (
            <div className="lg:sticky lg:top-4">
              <AthleteSummaryPanel athlete={selectedAthlete} onClose={() => setSelectedAthleteId(null)} />
            </div>
          )}
        </div>
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
