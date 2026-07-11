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
import { CalendarDays, X, Maximize2 } from "lucide-react";
import { metersFmt, secToClock } from "@/lib/format";
import { UserAvatar } from "@/components/user-avatar";
import { ReadinessBadge } from "@/components/readiness-badge";

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
  const [joinEmail, setJoinEmail] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinMessage, setJoinMessage] = useState("");
  // Clicking an athlete in the roster opens a quick-look summary panel
  // instead of navigating straight to their full page — lets a coach flip
  // through several athletes without losing their place in the roster.
  // "Full view" on the panel goes to the same /app/athletes/$athleteId
  // page the roster used to link to directly.
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

        <Card>
          <CardHeader><CardTitle>Roster</CardTitle></CardHeader>
          <CardContent className="p-0">
            {!roster || roster.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No athletes yet.</p>
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

      {/* Backdrop — click-away to close. Only rendered (and only blocks
          clicks) once an athlete is actually selected. */}
      {selectedAthleteId && (
        <div
          className="fixed inset-0 z-40 bg-black/20"
          onClick={() => setSelectedAthleteId(null)}
          aria-hidden="true"
        />
      )}

      <AthleteSummaryPanel
        athleteId={selectedAthleteId}
        athlete={roster?.find((r: any) => r.athlete_id === selectedAthleteId)?.athletes ?? null}
        onClose={() => setSelectedAthleteId(null)}
      />
    </AppShell>
  );
}

// Slide-in quick-look panel — recent totals, current training load, and a
// handful of recent sessions for whichever athlete is selected in the
// roster, without leaving this page. "Full view" goes to the same
// /app/athletes/$athleteId page the roster used to link to directly.
//
// Scope note: real time-in-zone (like a full HR zone breakdown) isn't
// included yet — that would read from session_zone_time, and I haven't
// confirmed that table's actual columns against this schema. Everything
// here reuses queries/tables already proven out on the full athlete page
// (athlete_load_daily, sessions) so it's safe to ship without that.
function AthleteSummaryPanel({
  athleteId,
  athlete,
  onClose,
}: {
  athleteId: string | null;
  athlete: any;
  onClose: () => void;
}) {
  const isOpen = !!athleteId;

  const { data: load } = useQuery({
    queryKey: ["panel-load", athleteId],
    enabled: isOpen,
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_load_daily")
        .select("*")
        .eq("athlete_id", athleteId!)
        .order("load_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as any;
    },
  });

  // Last 7 days — summary totals row (distance/time/workout count).
  const { data: rangeSessions } = useQuery({
    queryKey: ["panel-range-sessions", athleteId],
    enabled: isOpen,
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase
        .from("sessions")
        .select("id, total_distance_m, total_time_seconds, completed_at")
        .eq("athlete_id", athleteId!)
        .gte("session_date", since);
      return data ?? [];
    },
  });

  // Most recent sessions regardless of date — the mini list underneath.
  const { data: recentSessions } = useQuery({
    queryKey: ["panel-recent-sessions", athleteId],
    enabled: isOpen,
    queryFn: async () => {
      const { data } = await supabase
        .from("sessions")
        .select("id, session_date, title, completed_at")
        .eq("athlete_id", athleteId!)
        .order("session_date", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  const completedInRange = (rangeSessions ?? []).filter((s: any) => s.completed_at);
  const rangeDistanceM = completedInRange.reduce((sum: number, s: any) => sum + Number(s.total_distance_m ?? 0), 0);
  const rangeTimeS = completedInRange.reduce((sum: number, s: any) => sum + Number(s.total_time_seconds ?? 0), 0);

  return (
    <div
      className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[400px] bg-background border-l shadow-xl transform transition-transform duration-300 overflow-y-auto ${
        isOpen ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {athlete && (
        <div className="p-4 space-y-5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <UserAvatar name={athlete.name} imageUrl={athlete.profile_image_url} size="lg" />
              <div className="min-w-0">
                <div className="font-semibold truncate">{athlete.name}</div>
                <div className="text-xs text-muted-foreground truncate">{athlete.primary_event ?? "—"}</div>
              </div>
            </div>
            <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button asChild size="sm" className="flex-1">
              <Link to="/app/athletes/$athleteId" params={{ athleteId: athlete.id }}>
                <Maximize2 className="h-3.5 w-3.5 mr-1.5" /> Full view
              </Link>
            </Button>
            <Button asChild size="icon" variant="outline" title="View calendar">
              <Link to="/app/sessions/calendar" search={{ athleteId: athlete.id } as any}>
                <CalendarDays className="h-4 w-4" />
              </Link>
            </Button>
          </div>

          {load && (
            <ReadinessBadge
              status={load.readiness_status}
              score={load.readiness_score}
              confidence={load.confidence}
            />
          )}

          <div>
            <div className="text-xs text-muted-foreground mb-2">Last 7 days</div>
            <div className="grid grid-cols-3 gap-2">
              <div className="border rounded-lg px-2 py-2 text-center">
                <div className="text-base font-semibold tabular-nums">{metersFmt(rangeDistanceM)}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Distance</div>
              </div>
              <div className="border rounded-lg px-2 py-2 text-center">
                <div className="text-base font-semibold tabular-nums">{completedInRange.length}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Workouts</div>
              </div>
              <div className="border rounded-lg px-2 py-2 text-center">
                <div className="text-base font-semibold tabular-nums">{secToClock(rangeTimeS)}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Time</div>
              </div>
            </div>
          </div>

          {load && (
            <div>
              <div className="text-xs text-muted-foreground mb-2">Training load</div>
              <div className="grid grid-cols-3 gap-2">
                <div className="border rounded-lg px-2 py-2 text-center">
                  <div className="text-base font-semibold tabular-nums">{load.ctl?.toFixed?.(0) ?? "—"}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">CTL</div>
                </div>
                <div className="border rounded-lg px-2 py-2 text-center">
                  <div className="text-base font-semibold tabular-nums">{load.atl?.toFixed?.(0) ?? "—"}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">ATL</div>
                </div>
                <div className="border rounded-lg px-2 py-2 text-center">
                  <div className="text-base font-semibold tabular-nums">{load.tsb?.toFixed?.(0) ?? "—"}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">TSB</div>
                </div>
              </div>
            </div>
          )}

          <div>
            <div className="text-xs text-muted-foreground mb-2">Recent sessions</div>
            {!recentSessions || recentSessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sessions yet.</p>
            ) : (
              <div className="divide-y border rounded-lg overflow-hidden">
                {recentSessions.map((s: any) => (
                  <Link
                    key={s.id}
                    to="/app/sessions/$sessionId"
                    params={{ sessionId: s.id }}
                    className="flex justify-between items-center px-3 py-2 text-sm hover:bg-accent/40"
                  >
                    <span className="truncate">
                      {s.session_date} · {s.title}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">
                      {s.completed_at ? "Done" : "Planned"}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
