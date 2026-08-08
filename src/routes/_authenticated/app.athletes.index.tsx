import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyRawRoles } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Users,
  Eye,
  Mail,
  UserMinus,
  UserPlus,
  Bandage,
} from "lucide-react";
import { AthleteSummaryPanel } from "@/components/athlete-summary-panel";
import { ReadinessBadge } from "@/components/readiness-badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TIMEZONE_OPTIONS, guessLocalTimezone } from "@/lib/timezones";
import { todayISO } from "@/lib/format";
import { athleteNavTabs } from "@/lib/athlete-nav-tabs";

export const Route = createFileRoute("/_authenticated/app/athletes/")({
  component: AthletesPage,
});

// "Last logged 3d ago" style relative text for each roster row — same
// rounding as the Home dashboard's roster widgets (just-now / minutes /
// hours / days), duplicated locally rather than shared since it's a tiny
// pure function and this file doesn't otherwise depend on dashboard-widgets.
function formatRelative(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// Whether an athlete's OWN independent login can be invited right now.
// Deliberately conservative: a DOB that's missing entirely is treated the
// same as a confirmed minor (block, don't assume adult) — the point of
// this check is to make sure a minor never gets their own account without
// a parent already in the loop, so guessing "probably an adult" when we
// genuinely don't know defeats that. Once a DOB is set and shows 18+,
// invites are unrestricted as before. Under 18 (or unknown) requires an
// ACTIVE parent link first — recorded consent from a parent/guardian
// before the athlete gets their own account.
function ageStatus(dob: string | null | undefined): "adult" | "minor_or_unknown" {
  if (!dob) return "minor_or_unknown";
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return "minor_or_unknown";
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
  if (!hasHadBirthdayThisYear) age--;
  return age >= 18 ? "adult" : "minor_or_unknown";
}

function AthletesPage() {
  const { user } = useAuthUser();
  const { data: rawRoles = [] } = useMyRawRoles();
  const isManager = rawRoles.includes("manager");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [event, setEvent] = useState("");
  const [dob, setDob] = useState("");
  const [email, setEmail] = useState("");
  // Separate from `email` above — that one is specifically for the
  // "become a Strider user" invite flow (writes an athlete_invites row).
  // This is a plain contact address on the athlete themselves, for coaches
  // whose athletes work "old school" without the app at all — used by the
  // Deliver Program flow to email them an Excel copy of their sessions.
  const [contactEmail, setContactEmail] = useState("");
  // Defaults to the coach's own browser-detected timezone — a reasonable
  // guess for a new athlete, and adjustable right here before saving.
  // Previously there was no way to set this at all, so every new athlete
  // silently landed on the DB default (UTC), which threw off session-time
  // classification (Morning/Afternoon/Evening) for every session they
  // ever uploaded until someone corrected it directly in the database.
  const [timezone, setTimezone] = useState(guessLocalTimezone());
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteLinkLabel, setInviteLinkLabel] = useState("Invite link ready");
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

  // Arriving here via a breadcrumb ("Athletes" link) from a page that was
  // scrolled a long way down is a client-side route change, so the browser
  // won't reset scroll on its own — without this, the roster could open
  // already scrolled partway down instead of at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Key deliberately NOT "roster" plain — the Home dashboard's
  // useHomeRoster hook uses that same ["roster", user.id, isManager] key
  // but selects a narrower set of columns (no email, user_id,
  // athlete_invites, or timezone). Sharing the key meant this page could
  // silently receive that narrower cached shape instead of its own,
  // making invite/email status look wrong whenever Home loaded first —
  // same root cause as the readiness-query crash below, just a silent
  // data bug instead of a thrown error.
  const { data: roster } = useQuery({
    queryKey: ["athletes-page-roster", user?.id, isManager],
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

  // Parent-link counts + pending parent-invite tokens per athlete, so the
  // roster can show "1 parent linked" / offer to copy an outstanding
  // invite instead of always minting a new one. One query for the whole
  // roster rather than N+1 per-row queries.
  const athleteIds = (roster ?? []).map((r: any) => r.athlete_id);
  const { data: parentInfo } = useQuery({
    queryKey: ["roster-parent-info", athleteIds.join(",")],
    enabled: athleteIds.length > 0,
    queryFn: async () => {
      const [{ data: links, error: linksErr }, { data: invites, error: invitesErr }] = await Promise.all([
        supabase.from("parent_athlete_links").select("athlete_id").in("athlete_id", athleteIds).eq("status", "active"),
        supabase.from("parent_invites").select("athlete_id, token, accepted_at, email").in("athlete_id", athleteIds),
      ]);
      if (linksErr) { toast.error(linksErr.message); }
      if (invitesErr) { toast.error(invitesErr.message); }
      const countByAthlete = new Map<string, number>();
      for (const l of links ?? []) countByAthlete.set(l.athlete_id, (countByAthlete.get(l.athlete_id) ?? 0) + 1);
      const pendingByAthlete = new Map<string, { token: string; email: string }>();
      for (const inv of invites ?? []) {
        if (!inv.accepted_at) pendingByAthlete.set(inv.athlete_id, { token: inv.token, email: inv.email });
      }
      return { countByAthlete, pendingByAthlete };
    },
  });

  // Public Athlete Page slugs for the whole roster in one batched query —
  // needed so each row's "Athlete Page" icon can link straight to the
  // existing public page when one exists, same as AthleteSubnav does for a
  // single athlete. Batched here for the same reason parentInfo is: one
  // query for the whole roster, not one per row.
  const { data: profileSlugs } = useQuery({
    queryKey: ["roster-athlete-slugs", athleteIds.join(",")],
    enabled: athleteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("athlete_profiles")
        .select("athlete_id, slug")
        .in("athlete_id", athleteIds);
      if (error) { toast.error(error.message); return new Map<string, string>(); }
      const m = new Map<string, string>();
      for (const p of data ?? []) m.set(p.athlete_id, p.slug);
      return m;
    },
  });

  // Today's readiness (Ready/Caution/Recover) per athlete, batched the same
  // way parentInfo and profileSlugs are — one query for the whole roster —
  // so each row can show its flag without an N+1 query per athlete.
  // Key is deliberately NOT "roster-readiness" — the Home dashboard's
  // useRosterReadiness hook already uses that exact key (same athlete-id
  // list) but caches a plain array, not a Map. Reusing the same key here
  // meant the two pages could serve each other's cached shape and crash
  // with a "X.get is not a function" error, since React Query treats
  // identical keys as the same cache entry regardless of what each call
  // site expects back.
  const { data: readinessByAthlete } = useQuery({
    queryKey: ["athletes-page-readiness", athleteIds.join(",")],
    enabled: athleteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_load_daily")
        .select("athlete_id, readiness_status, readiness_score, confidence")
        .in("athlete_id", athleteIds)
        .eq("load_date", todayISO());
      if (error) { toast.error(error.message); return new Map<string, any>(); }
      const m = new Map<string, any>();
      for (const r of data ?? []) m.set(r.athlete_id, r);
      return m;
    },
  });

  // Active (non-resolved) injury count per athlete — same batching
  // pattern, used to show a small injury flag next to the readiness badge.
  const { data: injuryCountByAthlete } = useQuery({
    queryKey: ["roster-injuries", athleteIds.join(",")],
    enabled: athleteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("injuries")
        .select("athlete_id")
        .in("athlete_id", athleteIds)
        .neq("status", "resolved");
      if (error) { toast.error(error.message); return new Map<string, number>(); }
      const m = new Map<string, number>();
      for (const i of data ?? []) m.set(i.athlete_id, (m.get(i.athlete_id) ?? 0) + 1);
      return m;
    },
  });

  const selectedAthlete = roster?.find((r: any) => r.athlete_id === selectedAthleteId)?.athletes ?? null;

  async function addAthlete() {
    if (!name) { toast.error("Name required"); return; }
    const { data: ath, error } = await supabase.from("athletes").insert({
      name, primary_event: event || null, created_by: user!.id, timezone,
      email: contactEmail || null, dob: dob || null,
    }).select().single();
    if (error || !ath) { toast.error(error?.message ?? "Failed"); return; }
    await supabase.from("coach_athletes").insert({ coach_user_id: user!.id, athlete_id: ath.id });
    if (email) {
      // A brand-new athlete can't have an active parent link yet (there's
      // been no chance to invite one), so ageStatus alone decides here —
      // this only ever fires for a confirmed adult (a DOB was entered
      // showing 18+). Anyone else (no DOB entered, or a minor's DOB)
      // skips the auto-invite entirely rather than silently handing out
      // an independent login with no parent in the loop yet.
      if (ageStatus(dob) === "adult") {
        const { data: inv } = await supabase.from("athlete_invites").insert({
          coach_user_id: user!.id, athlete_id: ath.id, email,
        }).select("token").single();
        if (inv?.token) {
          setInviteLinkLabel("Invite link ready");
          setInviteLink(`${window.location.origin}/claim/${inv.token}`);
        }
      } else {
        toast.info(
          "This athlete is under 18 (or no date of birth was entered) — their own login isn't sent automatically. Invite a parent/guardian from their row first; their login invite becomes available once a parent has linked.",
        );
      }
    }
    setName(""); setEvent(""); setDob(""); setEmail(""); setContactEmail("");
    toast.success("Athlete added");
    qc.invalidateQueries({ queryKey: ["athletes-page-roster"] });
  }

  async function updateContactEmail(athleteId: string, current: string | null) {
    const next = window.prompt("Contact email for sending programs directly (leave blank to clear):", current ?? "");
    if (next === null) return; // cancelled
    const { error } = await supabase.from("athletes").update({ email: next.trim() || null }).eq("id", athleteId);
    if (error) { toast.error(error.message); return; }
    toast.success(next.trim() ? "Contact email saved" : "Contact email cleared");
    qc.invalidateQueries({ queryKey: ["athletes-page-roster"] });
  }

  async function updateDob(athleteId: string, current: string | null) {
    const next = window.prompt("Date of birth (YYYY-MM-DD) — leave blank to clear:", current ?? "");
    if (next === null) return; // cancelled
    const trimmed = next.trim();
    if (trimmed && Number.isNaN(new Date(trimmed).getTime())) {
      toast.error("Couldn't read that as a date — use YYYY-MM-DD.");
      return;
    }
    const { error } = await supabase.from("athletes").update({ dob: trimmed || null }).eq("id", athleteId);
    if (error) { toast.error(error.message); return; }
    toast.success(trimmed ? "Date of birth saved" : "Date of birth cleared");
    qc.invalidateQueries({ queryKey: ["athletes-page-roster"] });
  }

  async function copyExistingInvite(athleteId: string, existing: any, dob: string | null, hasActiveParentLink: boolean) {
    let token: string | undefined = existing?.[0]?.token && !existing?.[0]?.accepted_at ? existing[0].token : undefined;
    if (!token) {
      if (ageStatus(dob) !== "adult" && !hasActiveParentLink) {
        toast.error(
          "This athlete is under 18 (or has no date of birth set) — invite a parent/guardian first from their row. Their own login invite becomes available once a parent has linked.",
        );
        return;
      }
      const inviteEmail = window.prompt("Email to send the invite to:");
      if (!inviteEmail) return;
      const { data, error } = await supabase.from("athlete_invites").insert({
        coach_user_id: user!.id, athlete_id: athleteId, email: inviteEmail,
      }).select("token").single();
      if (error || !data) { toast.error(error?.message ?? "Failed"); return; }
      token = data.token;
      qc.invalidateQueries({ queryKey: ["athletes-page-roster"] });
    }
    const link = `${window.location.origin}/claim/${token}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Invite link copied");
    } catch {
      setInviteLinkLabel("Invite link ready");
      setInviteLink(link);
    }
  }

  // Sends (or re-copies a pending) parent invite for this athlete. Coach
  // grants access explicitly by choosing who to invite — mirrors the
  // athlete invite flow exactly, just against parent_invites instead.
  async function inviteParent(athleteId: string, pending: { token: string; email: string } | undefined) {
    let token = pending?.token;
    if (!token) {
      const inviteEmail = window.prompt("Parent/guardian email to invite:");
      if (!inviteEmail) return;
      const { data, error } = await supabase.from("parent_invites").insert({
        coach_user_id: user!.id, athlete_id: athleteId, email: inviteEmail,
      }).select("token").single();
      if (error || !data) { toast.error(error?.message ?? "Failed"); return; }
      token = data.token;
      qc.invalidateQueries({ queryKey: ["roster-parent-info"] });
    }
    const link = `${window.location.origin}/claim/${token}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Parent invite link copied");
    } catch {
      setInviteLinkLabel("Parent invite link ready");
      setInviteLink(link);
    }
  }

  async function copyLink() {
    if (!inviteLink) return;
    try { await navigator.clipboard.writeText(inviteLink); toast.success("Copied"); }
    catch { toast.error("Copy failed — select the link manually"); }
  }

  // Unlinks this athlete from the current coach's own roster
  // (coach_athletes) — doesn't touch the athletes row itself or any of
  // their training data, and doesn't affect any OTHER coach who might
  // also have this athlete linked. If they were invited but never
  // claimed their account, this also means the invite link (if still
  // unused) no longer has a roster link to attach to — they'd need a
  // fresh "Add an athlete" + invite to be added back.
  async function removeFromRoster(athleteId: string) {
    const { error } = await supabase
      .from("coach_athletes")
      .delete()
      .eq("coach_user_id", user!.id)
      .eq("athlete_id", athleteId);
    if (error) { toast.error(error.message); return; }
    if (selectedAthleteId === athleteId) setSelectedAthleteId(null);
    toast.success("Removed from your roster");
    qc.invalidateQueries({ queryKey: ["athletes-page-roster"] });
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
    qc.invalidateQueries({ queryKey: ["athletes-page-roster"] });
  }

  return (
    <AppShell fullWidth>
      <div className="space-y-6">
        {/* Icon + eyebrow heading, matching the pattern used on Calendar and
            elsewhere in the app — a colored icon block + small-caps eyebrow
            above the page title, instead of a bare <h1>. */}
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
            style={{ background: "var(--accent-red)" }}
          >
            <Users className="h-5 w-5 text-white" strokeWidth={2} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Coaching</div>
            <h1 className="text-2xl font-bold leading-tight">Athletes</h1>
          </div>
        </div>

        {/* Roster leads the page at 2/3 width — it's what a coach actually
            wants on arrival. Add/invite (and the quick-view summary panel
            when something's selected) live in the final third rather than
            pushing the roster down the page. Full width so the roster can
            show every sub-page icon on one line without crowding. */}
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr] items-start">
          <Card className="min-w-0">
            <CardHeader><CardTitle>Roster</CardTitle></CardHeader>
            <CardContent className="p-0">
              {!roster || roster.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No athletes yet — add one in the panel to the right.</p>
              ) : (
                <div className="divide-y">
                  {roster.map((r: any) => {
                    const parentCount = parentInfo?.countByAthlete.get(r.athlete_id) ?? 0;
                    const pendingParentInvite = parentInfo?.pendingByAthlete.get(r.athlete_id);
                    const slug = profileSlugs?.get(r.athlete_id) ?? null;
                    const tabs = athleteNavTabs(r.athlete_id, slug);
                    const readiness = readinessByAthlete?.get(r.athlete_id);
                    const injuryCount = injuryCountByAthlete?.get(r.athlete_id) ?? 0;
                    return (
                      <div
                        key={r.athlete_id}
                        onClick={() => navigate({ to: "/app/athletes/$athleteId", params: { athleteId: r.athlete_id } })}
                        className={`flex flex-col gap-2 px-4 py-3 rounded-md border-2 transition-colors hover:bg-accent/40 hover:border-[var(--accent-red)] cursor-pointer ${
                          selectedAthleteId === r.athlete_id ? "bg-accent/60 border-[var(--accent-red)]" : "border-transparent"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              // Keeps opening Quick View, not Full View —
                              // this is the one deliberate exception (see
                              // the comment above selectedAthleteId) to the
                              // row's new click-anywhere-for-Full-View
                              // fallback below.
                              e.stopPropagation();
                              setSelectedAthleteId(r.athlete_id);
                            }}
                            title="Quick view"
                            className="flex items-center gap-3 min-w-0 text-left group"
                          >
                            <UserAvatar
                              name={r.athletes?.name}
                              imageUrl={r.athletes?.profile_image_url ?? undefined}
                              size="md"
                              className="shrink-0"
                            />
                            <div className="min-w-0">
                              <div className="flex items-baseline gap-2">
                                <span className="font-medium truncate">{r.athletes?.name}</span>
                                {/* Only shown when actually set — this used
                                    to always render an em-dash placeholder
                                    when an athlete had no primary event,
                                    which read as a stray "-" on every row. */}
                                {r.athletes?.primary_event && (
                                  <span className="text-xs text-muted-foreground truncate shrink-0">{r.athletes.primary_event}</span>
                                )}
                                <Eye className="h-3.5 w-3.5 shrink-0 text-[var(--accent-red)]/50 group-hover:text-[var(--accent-red)] transition-colors" />
                              </div>
                              <div className="text-[11px] text-muted-foreground truncate">
                                {r.athletes?.last_log_at ? `Last logged ${formatRelative(r.athletes.last_log_at)}` : "No sessions logged yet"}
                              </div>
                            </div>
                          </button>

                          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                            {/* Readiness / injury flags — visible at a glance
                                without opening the quick-view popup. */}
                            {readiness?.readiness_status && (
                              <ReadinessBadge
                                status={readiness.readiness_status}
                                score={readiness.readiness_score}
                                confidence={readiness.confidence}
                              />
                            )}
                            {injuryCount > 0 && (
                              <Badge
                                variant="outline"
                                title={`${injuryCount} active injur${injuryCount > 1 ? "ies" : "y"}`}
                                className="gap-1 border-rose-500/30 bg-rose-500/10 text-rose-600"
                              >
                                <Bandage className="h-3 w-3" />
                                {injuryCount}
                              </Badge>
                            )}

                            {/* Sub-page jump strip — one icon per athlete page
                                (Overview, Calendar, Sessions, Analytics,
                                Health, Performance Profile, Zones, Races,
                                Athlete Page), always red so it reads as a
                                distinct row of quick links rather than
                                generic toolbar buttons. Own stopPropagation
                                so a click here goes to that specific
                                sub-page, not the row's Full-View fallback. */}
                            <div
                              className="flex items-center gap-0.5 overflow-x-auto no-scrollbar"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {tabs.map((t) => (
                                <Button
                                  key={t.key}
                                  asChild
                                  size="icon"
                                  variant="ghost"
                                  title={t.label}
                                  className="h-8 w-8 text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10 hover:text-[var(--accent-red)]"
                                >
                                  <Link to={t.to as any} params={(t as any).params as any} search={(t as any).search as any}>
                                    <t.icon className="h-4 w-4" />
                                  </Link>
                                </Button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Second line's own controls (invite, email, parent,
                            remove) each need the click to stay theirs, not
                            fall through to the row's Full-View navigation —
                            one shared stopPropagation on the whole line
                            rather than repeating it on every button/badge
                            inside it. */}
                        <div
                          className="flex items-center justify-between gap-3 flex-wrap pl-12"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {r.athletes?.user_id ? (
                              <Badge variant="secondary">Linked</Badge>
                            ) : (
                              <>
                                <Badge variant="outline">Invite pending</Badge>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    copyExistingInvite(
                                      r.athlete_id,
                                      r.athlete_invites,
                                      r.athletes?.dob ?? null,
                                      (parentInfo?.countByAthlete.get(r.athlete_id) ?? 0) > 0,
                                    )
                                  }
                                >
                                  {r.athlete_invites?.length ? "Copy invite link" : "Generate invite link"}
                                </Button>
                              </>
                            )}
                            <Badge
                              variant="outline"
                              title={r.athletes?.email ? `Contact email: ${r.athletes.email}` : "No contact email on file"}
                              className={`cursor-pointer gap-1 ${r.athletes?.email ? "" : "text-muted-foreground"}`}
                              onClick={() => updateContactEmail(r.athlete_id, r.athletes?.email ?? null)}
                            >
                              <Mail className="h-3 w-3" />
                              {r.athletes?.email ? "Email on file" : "No email"}
                            </Badge>
                            <Badge
                              variant="outline"
                              title={
                                r.athletes?.dob
                                  ? `Date of birth: ${r.athletes.dob} (${ageStatus(r.athletes.dob) === "adult" ? "18+" : "under 18"})`
                                  : "No date of birth on file — treated as under 18 for the independent-login gate"
                              }
                              className={`cursor-pointer gap-1 ${
                                ageStatus(r.athletes?.dob ?? null) === "adult" ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"
                              }`}
                              onClick={() => updateDob(r.athlete_id, r.athletes?.dob ?? null)}
                            >
                              {r.athletes?.dob ? (ageStatus(r.athletes.dob) === "adult" ? "18+" : "Under 18") : "No DOB"}
                            </Badge>
                            {/* Parent invite — coach-granted, mirrors the
                                athlete invite affordance. Shows a count badge
                                once at least one parent is linked so it's
                                obvious at a glance who already has access. */}
                            {parentCount > 0 ? (
                              <Badge
                                variant="outline"
                                title="Parents/guardians linked"
                                className="cursor-pointer"
                                onClick={() => inviteParent(r.athlete_id, undefined)}
                              >
                                <UserPlus className="h-3 w-3 mr-1" />
                                {parentCount} parent{parentCount > 1 ? "s" : ""}
                              </Badge>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Invite a parent or guardian"
                                onClick={() => inviteParent(r.athlete_id, pendingParentInvite)}
                              >
                                <UserPlus className="h-3.5 w-3.5 mr-1" />
                                {pendingParentInvite ? "Copy parent link" : "Invite parent"}
                              </Button>
                            )}
                          </div>

                          {/* Manager view lists every athlete in the org
                              directly from the athletes table, not via a
                              personal coach_athletes link — there's nothing
                              to "remove" in the same sense there, so this
                              only shows for a regular coach's own roster. */}
                          {!isManager && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="icon" variant="ghost" title="Remove from roster" className="text-muted-foreground hover:text-destructive">
                                  <UserMinus className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Remove {r.athletes?.name} from your roster?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This only removes them from your own roster — their account and training data
                                    aren't deleted, and any other coach they're linked to keeps their own access.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => removeFromRoster(r.athlete_id)}>Remove</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Final third of the page — Add an athlete and Invite an existing
              account. Sticky so it stays in view as a long roster scrolls
              past it. Quick-view used to render here too, but on a long
              roster that meant scrolling back up to actually see it after
              clicking a row further down — it's now a fixed side panel
              (below) instead, which stays in place regardless of scroll. */}
          <div className="space-y-6 lg:sticky lg:top-4">
            <Card>
              <CardHeader>
                <CardTitle>Add an athlete</CardTitle>
                <CardDescription>
                  Creates the athlete in your roster. Invite email is optional — they can link later by signing in.
                  Contact email is separate, for sending programs directly to athletes who don't use the app.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div><Label>Primary event</Label><Input placeholder="800m" value={event} onChange={(e) => setEvent(e.target.value)} /></div>
                <div>
                  <Label>Date of birth</Label>
                  <Input type="date" max={todayISO()} value={dob} onChange={(e) => setDob(e.target.value)} />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Used to protect athletes under 18 — their own login can't be sent until a parent/guardian has
                    linked first. Leave blank and it's treated the same as under 18 for that check.
                  </p>
                </div>
                <div><Label>Invite email (optional)</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                <div>
                  <Label>Contact email (optional — for sending programs directly, no app account needed)</Label>
                  <Input type="email" placeholder="athlete@example.com" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
                </div>
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
                <div><Button onClick={addAthlete}>Add</Button></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Invite an existing account</CardTitle>
                <CardDescription>If the athlete already has a Strider account, send them a join request — they'll see it on their Profile.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div><Label>Account email</Label><Input type="email" value={joinEmail} onChange={(e) => setJoinEmail(e.target.value)} /></div>
                <div><Label>Display name (optional)</Label><Input value={joinName} onChange={(e) => setJoinName(e.target.value)} /></div>
                <div><Label>Message (optional)</Label><Input value={joinMessage} onChange={(e) => setJoinMessage(e.target.value)} /></div>
                <div><Button variant="outline" onClick={sendJoinRequest}>Send join request</Button></div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Quick-view popup — a fixed side panel rather than an in-flow
          column, so clicking a row far down a long roster doesn't require
          scrolling back up to see it. Closes on outside click, Esc, or its
          own close button. */}
      <Sheet open={!!selectedAthlete} onOpenChange={(o) => !o && setSelectedAthleteId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto brand-scrollbar">
          <SheetHeader>
            <SheetTitle className="sr-only">Athlete quick view</SheetTitle>
          </SheetHeader>
          <AthleteSummaryPanel athlete={selectedAthlete} embedded onClose={() => setSelectedAthleteId(null)} />
        </SheetContent>
      </Sheet>

      <Dialog open={!!inviteLink} onOpenChange={(o) => !o && setInviteLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{inviteLinkLabel}</DialogTitle>
            <DialogDescription>Send this link. It's valid for 30 days and works once.</DialogDescription>
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
