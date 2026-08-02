import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyAthlete, useMyRoles, useCoachRoster } from "@/lib/use-auth";
import { useEffectiveRole } from "@/lib/view-mode";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { todayISO } from "@/lib/format";
import { toast } from "sonner";
import { Plus, ChevronDown, ChevronUp, Archive, ArchiveRestore, Trash2, Bandage } from "lucide-react";
import { BucketTabStrip, healthTabsFor } from "@/components/bucket-tab-strip";
import { AthleteSubnav } from "@/components/athlete-subnav";
import { CoachAthletePicker } from "@/components/coach-athlete-picker";
import { BodyMapPicker, BodyMapIcon, regionLabel } from "@/components/body-map";

const searchSchema = z.object({
  athleteId: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/app/injuries")({
  validateSearch: searchSchema,
  component: InjuriesPage,
});

function InjuriesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const { isCoachView } = useEffectiveRole();
  const { data: myAthlete } = useMyAthlete();
  const [showNewForm, setShowNewForm] = useState(false);

  const selectedAthleteId = search.athleteId ?? (!isCoachView ? myAthlete?.id : undefined);

  const { data: roster } = useCoachRoster();
  const rosterAthletes = useMemo(() => (roster ?? []).map((r: any) => r.athletes).filter(Boolean), [roster]);
  const sortedRoster = useMemo(
    () => [...rosterAthletes].sort((a: any, b: any) => (a.name ?? "").localeCompare(b.name ?? "")),
    [rosterAthletes],
  );

  useEffect(() => {
    if (isCoachView && !search.athleteId && sortedRoster.length > 0) {
      navigate({ search: { athleteId: sortedRoster[0].id } as any });
    }
  }, [isCoachView, search.athleteId, sortedRoster, navigate]);

  const { data: athleteRow, isLoading: athleteRowLoading } = useQuery({
    queryKey: ["injuries-athlete", selectedAthleteId],
    enabled: !!selectedAthleteId,
    queryFn: async () => {
      const { data, error } = await supabase.from("athletes").select("id, name").eq("id", selectedAthleteId!).single();
      if (error) throw error;
      return data as any;
    },
  });

  if (isCoachView && !selectedAthleteId) {
    if (rosterAthletes.length === 0) {
      return (
        <AppShell fullWidth>
          <p className="text-sm text-muted-foreground">No athletes on your roster yet — add one from Manage Athletes.</p>
        </AppShell>
      );
    }
    return <AppShell fullWidth><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  }

  if (athleteRowLoading) return <AppShell fullWidth><p>Loading…</p></AppShell>;
  if (!selectedAthleteId || !athleteRow)
    return (
      <AppShell fullWidth>
        <p className="text-sm">
          No athlete profile linked. Visit <Link to="/app/account" className="underline">Account</Link>.
        </p>
      </AppShell>
    );

  return (
    <AppShell fullWidth>
      <div className="space-y-6 max-w-3xl">
        {isCoach && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 min-w-0">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground shrink-0">
                <Link to="/app/athletes" className="hover:text-foreground">Athletes</Link>
                <span className="text-border">/</span>
                <Link to="/app/athletes/$athleteId" params={{ athleteId: selectedAthleteId }} className="hover:text-foreground">
                  {athleteRow.name}
                </Link>
              </div>
              <AthleteSubnav athleteId={selectedAthleteId} active="health" />
            </div>
            <div className="shrink-0">
              <CoachAthletePicker
                roster={rosterAthletes}
                myAthlete={myAthlete as any}
                value={selectedAthleteId}
                onChange={(v) => navigate({ search: { athleteId: v } as any })}
              />
            </div>
          </div>
        )}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
              style={{ background: "var(--accent-red)" }}
            >
              <Bandage className="h-5 w-5 text-white" strokeWidth={2} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Wellbeing</div>
              <h1 className="text-2xl font-bold leading-tight">Injury Management</h1>
              <p className="text-sm text-muted-foreground">
                Track a niggle from onset through to resolved, with dated updates along the way.
              </p>
            </div>
          </div>
          <Button size="sm" onClick={() => setShowNewForm((v) => !v)}>
            <Plus className="h-4 w-4 mr-1" /> {showNewForm ? "Cancel" : "Log new injury"}
          </Button>
        </div>
        <BucketTabStrip items={healthTabsFor(selectedAthleteId)} active="/app/injuries" />
        {showNewForm && <NewInjuryForm athleteId={selectedAthleteId} onSaved={() => setShowNewForm(false)} />}
        <InjuryList athleteId={selectedAthleteId} />
      </div>
    </AppShell>
  );
}

function NewInjuryForm({ athleteId, onSaved }: { athleteId: string; onSaved: () => void }) {
  const qc = useQueryClient();
  const [bodyPart, setBodyPart] = useState("");
  const [region, setRegion] = useState<string | null>(null);
  const [side, setSide] = useState<string>("n/a");
  const [severity, setSeverity] = useState("");
  const [onsetDate, setOnsetDate] = useState(todayISO());
  const [notes, setNotes] = useState("");

  async function save() {
    if (!bodyPart.trim()) {
      toast.error("Body part is required");
      return;
    }
    const { error } = await supabase.from("injuries").insert({
      athlete_id: athleteId,
      body_part: bodyPart.trim(),
      body_region: region,
      side,
      status: "active",
      severity: severity === "" ? null : Number(severity),
      onset_date: onsetDate,
      notes: notes || null,
    } as any);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Injury logged");
    qc.invalidateQueries({ queryKey: ["injuries", athleteId] });
    onSaved();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New injury</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-xs">Tap the general area — this sets side too (optional, still editable below)</Label>
          <div className="mt-2">
            <BodyMapPicker value={region ? { region, side: side as any } : null} onChange={(v) => { setRegion(v.region); setSide(v.side); }} />
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Body part</Label>
            <Input value={bodyPart} onChange={(e) => setBodyPart(e.target.value)} placeholder="e.g. Achilles, calf, hamstring" />
          </div>
          <div>
            <Label className="text-xs">Side</Label>
            <Select value={side} onValueChange={setSide}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="left">Left</SelectItem>
                <SelectItem value="right">Right</SelectItem>
                <SelectItem value="both">Both</SelectItem>
                <SelectItem value="n/a">N/A</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Onset date</Label>
            <Input type="date" value={onsetDate} max={todayISO()} onChange={(e) => setOnsetDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Severity (1–5, optional)</Label>
            <Input type="number" min={1} max={5} value={severity} onChange={(e) => setSeverity(e.target.value)} placeholder="3" />
          </div>
        </div>
        <Textarea placeholder="Describe what's going on" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Button onClick={save} className="w-full">
          Save injury
        </Button>
      </CardContent>
    </Card>
  );
}

const STATUS_LABEL: Record<string, string> = { active: "Active", monitoring: "Monitoring", resolved: "Resolved" };
const STATUS_VARIANT: Record<string, "destructive" | "secondary" | "outline"> = {
  active: "destructive",
  monitoring: "secondary",
  resolved: "outline",
};

function InjuryList({ athleteId }: { athleteId: string }) {
  const [showArchive, setShowArchive] = useState(false);
  const { data: injuries } = useQuery({
    queryKey: ["injuries", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("injuries")
        .select("*")
        .eq("athlete_id", athleteId)
        .order("onset_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  if (!injuries) return null;

  // Archived is independent of status — a resolved injury someone wants
  // out of sight goes here, but so could an old active one if it's just
  // cluttering the list. Filtered out of both the main lists below either
  // way, so nothing ever shows in two places at once.
  const archived = injuries.filter((i) => i.archived);
  const active = injuries.filter((i) => i.status !== "resolved" && !i.archived);
  const resolved = injuries.filter((i) => i.status === "resolved" && !i.archived);

  return (
    <div className="space-y-4">
      {active.length === 0 && resolved.length === 0 && archived.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            No injuries logged — nothing to see here, keep it that way!
          </CardContent>
        </Card>
      )}
      {active.map((i) => (
        <InjuryCard key={i.id} injury={i} athleteId={athleteId} defaultOpen />
      ))}
      {resolved.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Resolved</div>
          <div className="space-y-2">
            {resolved.map((i) => (
              <InjuryCard key={i.id} injury={i} athleteId={athleteId} />
            ))}
          </div>
        </div>
      )}
      {archived.length > 0 && (
        <div className="border-t pt-3">
          <button
            type="button"
            onClick={() => setShowArchive((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2"
          >
            <Archive className="h-3.5 w-3.5" />
            Filing cabinet ({archived.length})
            {showArchive ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {showArchive && (
            <div className="space-y-2">
              {archived.map((i) => (
                <InjuryCard key={i.id} injury={i} athleteId={athleteId} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InjuryCard({ injury, athleteId, defaultOpen }: { injury: any; athleteId: string; defaultOpen?: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(!!defaultOpen);
  const [addingUpdate, setAddingUpdate] = useState(false);
  const [updateSeverity, setUpdateSeverity] = useState("");
  const [updateNotes, setUpdateNotes] = useState("");

  // Full editable view of everything captured when this injury was first
  // logged — previously only notes were ever shown again after creation;
  // body part, region, side, severity, and onset date were write-once.
  const [editing, setEditing] = useState(false);
  const [eBodyPart, setEBodyPart] = useState(injury.body_part ?? "");
  const [eRegion, setERegion] = useState<string | null>(injury.body_region ?? null);
  const [eSide, setESide] = useState<string>(injury.side ?? "n/a");
  const [eSeverity, setESeverity] = useState<string>(injury.severity != null ? String(injury.severity) : "");
  const [eOnsetDate, setEOnsetDate] = useState<string>(injury.onset_date ?? todayISO());
  const [eNotes, setENotes] = useState<string>(injury.notes ?? "");

  // Healthcare provider tracking — whether the athlete is currently seeing
  // someone, plus a full appointment history (upcoming and past), not just
  // a single "next appointment" — a real injury usually means more than
  // one visit.
  const [seeingHcp, setSeeingHcp] = useState<boolean>(!!injury.seeing_hcp);
  const [showApptForm, setShowApptForm] = useState(false);
  const [apptHcpName, setApptHcpName] = useState("");
  const [apptAt, setApptAt] = useState("");
  const [apptNotes, setApptNotes] = useState("");
  const [savingAppt, setSavingAppt] = useState(false);

  const { data: updates } = useQuery({
    queryKey: ["injury-updates", injury.id],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("injury_updates")
        .select("*")
        .eq("injury_id", injury.id)
        .order("update_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // Every appointment ever logged for this injury, newest first — split
  // below into Upcoming (soonest first) and History (most recent past
  // first). calendar_entry_id (set once "Add to diary" is used, or when
  // the appointment was created from the diary side in the first place)
  // is what drives the "already on your diary" state per row.
  const { data: appointments } = useQuery({
    queryKey: ["injury-appointments", injury.id],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("injury_appointments" as any)
        .select("*")
        .eq("injury_id", injury.id)
        .order("appt_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const nowMs = Date.now();
  const upcomingAppts = [...(appointments ?? [])].filter((a) => new Date(a.appt_at).getTime() >= nowMs).reverse();
  const pastAppts = (appointments ?? []).filter((a) => new Date(a.appt_at).getTime() < nowMs);


  async function setStatus(status: string) {
    const patch: any = { status };
    // Auto-fill resolved_date the first time it's marked resolved; clear
    // it again if the status is walked back off "resolved" — the field
    // should only ever reflect the current resolved state, not a stale
    // date left over from a previous resolve/re-open cycle.
    if (status === "resolved" && !injury.resolved_date) patch.resolved_date = todayISO();
    if (status !== "resolved") patch.resolved_date = null;
    const { error } = await supabase.from("injuries").update(patch).eq("id", injury.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["injuries", athleteId] });
  }

  async function toggleArchive() {
    const { error } = await supabase.from("injuries").update({ archived: !injury.archived } as any).eq("id", injury.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(injury.archived ? "Moved out of the filing cabinet" : "Filed away");
    qc.invalidateQueries({ queryKey: ["injuries", athleteId] });
  }

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function deleteInjury() {
    setDeleting(true);
    const { error } = await supabase.from("injuries").delete().eq("id", injury.id);
    setDeleting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Injury deleted");
    qc.invalidateQueries({ queryKey: ["injuries", athleteId] });
  }

  async function saveDetails() {
    if (!eBodyPart.trim()) {
      toast.error("Body part is required");
      return;
    }
    const { error } = await supabase
      .from("injuries")
      .update({
        body_part: eBodyPart.trim(),
        body_region: eRegion,
        side: eSide,
        severity: eSeverity === "" ? null : Number(eSeverity),
        onset_date: eOnsetDate,
        notes: eNotes || null,
      } as any)
      .eq("id", injury.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Injury updated");
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["injuries", athleteId] });
  }

  async function toggleSeeingHcp(next: boolean) {
    setSeeingHcp(next);
    const { error } = await supabase.from("injuries").update({ seeing_hcp: next } as any).eq("id", injury.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["injuries", athleteId] });
  }

  async function addAppointment() {
    if (!apptAt) {
      toast.error("Pick a date and time first");
      return;
    }
    setSavingAppt(true);
    const { error } = await supabase.from("injury_appointments" as any).insert({
      injury_id: injury.id,
      athlete_id: athleteId,
      hcp_name: apptHcpName || null,
      appt_at: new Date(apptAt).toISOString(),
      notes: apptNotes || null,
    } as any);
    // Logging any appointment implies they're actively seeing someone —
    // flip the toggle on rather than making it a separate step.
    if (!error && !seeingHcp) {
      await supabase.from("injuries").update({ seeing_hcp: true } as any).eq("id", injury.id);
      setSeeingHcp(true);
    }
    setSavingAppt(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Appointment added");
    setApptHcpName("");
    setApptAt("");
    setApptNotes("");
    setShowApptForm(false);
    qc.invalidateQueries({ queryKey: ["injury-appointments", injury.id] });
    qc.invalidateQueries({ queryKey: ["injuries", athleteId] });
  }

  async function deleteAppointment(id: string) {
    const { error } = await supabase.from("injury_appointments" as any).delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["injury-appointments", injury.id] });
  }

  // Creates a linked entry on the athlete's own diary (My Schedule) for
  // one specific appointment. The reverse direction — booking or editing
  // an appointment there and tagging it with this injury — writes/updates
  // the matching injury_appointments row from that side too (see
  // PersonalEntryDialog), so either surface can be the one someone
  // actually uses and both stay in sync.
  async function addApptToDiary(appt: any) {
    const specificDate = String(appt.appt_at).slice(0, 10);
    const startTime = String(appt.appt_at).slice(11, 16);
    const { data, error } = await supabase
      .from("athlete_personal_calendar_entries" as any)
      .insert({
        athlete_id: athleteId,
        category: "appointment",
        title: `${appt.hcp_name || "Healthcare"} — ${injury.body_part}`,
        specific_date: specificDate,
        start_time: startTime,
        notes: appt.notes || `Linked to injury: ${injury.body_part}`,
        injury_id: injury.id,
      } as any)
      .select("id")
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase.from("injury_appointments" as any).update({ calendar_entry_id: (data as any).id } as any).eq("id", appt.id);
    toast.success("Added to your diary");
    qc.invalidateQueries({ queryKey: ["injury-appointments", injury.id] });
  }

  async function saveUpdate() {
    const { error } = await supabase.from("injury_updates").insert({
      injury_id: injury.id,
      athlete_id: athleteId,
      update_date: todayISO(),
      severity: updateSeverity === "" ? null : Number(updateSeverity),
      notes: updateNotes || null,
    } as any);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Update added");
    setUpdateSeverity("");
    setUpdateNotes("");
    setAddingUpdate(false);
    qc.invalidateQueries({ queryKey: ["injury-updates", injury.id] });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 text-left">
            {open ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
            <BodyMapIcon region={injury.body_region} side={injury.side} size="lg" />
            <div>
              <CardTitle className="text-base capitalize">
                {injury.body_part} {injury.side && injury.side !== "n/a" ? `(${injury.side})` : ""}
              </CardTitle>
              <CardDescription>
                Since{" "}
                {new Date(injury.onset_date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                {injury.severity != null && ` · started at ${injury.severity}/5`}
              </CardDescription>
            </div>
          </button>
          <Badge variant={STATUS_VARIANT[injury.status] ?? "secondary"}>{STATUS_LABEL[injury.status] ?? injury.status}</Badge>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          {editing ? (
            <div className="space-y-3 border rounded-md p-3">
              <BodyMapPicker value={eRegion ? { region: eRegion, side: eSide as any } : null} onChange={(v) => { setERegion(v.region); setESide(v.side); }} />
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Body part</Label>
                  <Input value={eBodyPart} onChange={(e) => setEBodyPart(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Side</Label>
                  <Select value={eSide} onValueChange={setESide}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="left">Left</SelectItem>
                      <SelectItem value="right">Right</SelectItem>
                      <SelectItem value="both">Both</SelectItem>
                      <SelectItem value="n/a">N/A</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Onset date</Label>
                  <Input type="date" value={eOnsetDate} max={todayISO()} onChange={(e) => setEOnsetDate(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Severity (1–5, optional)</Label>
                  <Input type="number" min={1} max={5} value={eSeverity} onChange={(e) => setESeverity(e.target.value)} />
                </div>
              </div>
              <Textarea value={eNotes} onChange={(e) => setENotes(e.target.value)} placeholder="Describe what's going on" />
              <div className="flex gap-2">
                <Button size="sm" onClick={saveDetails}>Save changes</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Details</div>
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
              </div>
              <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                <div><span className="text-foreground font-medium capitalize">{injury.body_part}</span> {injury.body_region && `· ${regionLabel(injury.body_region)}`}</div>
                <div>Side: {injury.side && injury.side !== "n/a" ? injury.side : "N/A"}</div>
                <div>Onset: {new Date(injury.onset_date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
                <div>Severity: {injury.severity != null ? `${injury.severity}/5` : "—"}</div>
              </div>
              {injury.notes && <p className="pt-1">{injury.notes}</p>}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {(["active", "monitoring", "resolved"] as const).map((s) => (
              <Button key={s} size="sm" variant={injury.status === s ? "default" : "outline"} onClick={() => setStatus(s)}>
                {STATUS_LABEL[s]}
              </Button>
            ))}
            <Button size="sm" variant="outline" onClick={toggleArchive} className="ml-auto">
              {injury.archived ? (
                <><ArchiveRestore className="h-3.5 w-3.5 mr-1" /> Restore</>
              ) : (
                <><Archive className="h-3.5 w-3.5 mr-1" /> File away</>
              )}
            </Button>
            {confirmingDelete ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Delete permanently?</span>
                <Button size="sm" variant="destructive" onClick={deleteInjury} disabled={deleting}>
                  {deleting ? "Deleting…" : "Yes, delete"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>Cancel</Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmingDelete(true)}>
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
              </Button>
            )}
          </div>

          <div className="border-t pt-3 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Healthcare provider</div>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-normal">Seeing a healthcare provider?</Label>
              <Switch checked={seeingHcp} onCheckedChange={toggleSeeingHcp} />
            </div>

            {upcomingAppts.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Upcoming</div>
                {upcomingAppts.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 text-sm rounded-md border border-border px-2.5 py-1.5">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{a.hcp_name || "Appointment"}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(a.appt_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </div>
                      {a.notes && <div className="text-xs text-muted-foreground mt-0.5">{a.notes}</div>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {a.calendar_entry_id ? (
                        <Link to="/app/my-schedule" className="text-xs text-muted-foreground underline">On diary</Link>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => addApptToDiary(a)}>Add to diary</Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => deleteAppointment(a.id)} aria-label="Delete appointment">
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {pastAppts.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">History</div>
                {pastAppts.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 text-sm rounded-md border border-border px-2.5 py-1.5">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{a.hcp_name || "Appointment"}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(a.appt_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </div>
                      {a.notes && <div className="text-xs text-muted-foreground mt-0.5">{a.notes}</div>}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => deleteAppointment(a.id)} aria-label="Delete appointment">
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {showApptForm ? (
              <div className="space-y-2 border rounded-md p-2.5">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Who</Label>
                    <Input value={apptHcpName} onChange={(e) => setApptHcpName(e.target.value)} placeholder="e.g. Dr. Patel, sports physio" />
                  </div>
                  <div>
                    <Label className="text-xs">Date & time</Label>
                    <Input type="datetime-local" value={apptAt} onChange={(e) => setApptAt(e.target.value)} />
                  </div>
                </div>
                <Textarea placeholder="Notes (optional)" value={apptNotes} onChange={(e) => setApptNotes(e.target.value)} rows={2} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={addAppointment} disabled={savingAppt || !apptAt}>
                    {savingAppt ? "Saving…" : "Save appointment"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowApptForm(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setShowApptForm(true)}>
                <Plus className="h-3 w-3 mr-1" /> Add appointment
              </Button>
            )}
          </div>

          <div className="border-t pt-3 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Updates</div>
            {!updates || updates.length === 0 ? (
              <p className="text-xs text-muted-foreground">No updates logged yet.</p>
            ) : (
              updates.map((u) => (
                <div key={u.id} className="text-xs border-l-2 border-border pl-2">
                  <span className="font-medium">
                    {new Date(u.update_date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                  {u.severity != null && ` · ${u.severity}/5`}
                  {u.notes && <div className="text-muted-foreground mt-0.5">{u.notes}</div>}
                </div>
              ))
            )}
            {addingUpdate ? (
              <div className="space-y-2 pt-1">
                <div>
                  <Label className="text-xs">Severity (1–5)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    value={updateSeverity}
                    onChange={(e) => setUpdateSeverity(e.target.value)}
                    className="w-20 h-8"
                  />
                </div>
                <Textarea placeholder="How's it feeling today?" value={updateNotes} onChange={(e) => setUpdateNotes(e.target.value)} rows={2} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveUpdate}>
                    Save update
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAddingUpdate(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setAddingUpdate(true)}>
                <Plus className="h-3 w-3 mr-1" /> Add update
              </Button>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
