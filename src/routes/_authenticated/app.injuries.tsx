import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyAthlete } from "@/lib/use-auth";
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
import { Plus, ChevronDown, ChevronUp } from "lucide-react";
import { BucketTabStrip, HEALTH_TABS } from "@/components/bucket-tab-strip";
import { BodyMapPicker, BodyMapIcon, regionLabel } from "@/components/body-map";

export const Route = createFileRoute("/_authenticated/app/injuries")({
  component: InjuriesPage,
});

function InjuriesPage() {
  const { data: athlete, isLoading } = useMyAthlete();
  const [showNewForm, setShowNewForm] = useState(false);

  if (isLoading) return <AppShell><p>Loading…</p></AppShell>;
  if (!athlete)
    return (
      <AppShell>
        <p className="text-sm">
          No athlete profile linked. Visit <Link to="/app/profile" className="underline">Profile</Link>.
        </p>
      </AppShell>
    );

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Injury Management</h1>
            <p className="text-sm text-muted-foreground">
              Track a niggle from onset through to resolved, with dated updates along the way.
            </p>
          </div>
          <Button size="sm" onClick={() => setShowNewForm((v) => !v)}>
            <Plus className="h-4 w-4 mr-1" /> {showNewForm ? "Cancel" : "Log new injury"}
          </Button>
        </div>
        <BucketTabStrip items={HEALTH_TABS} active="/app/injuries" />
        {showNewForm && <NewInjuryForm athleteId={athlete.id} onSaved={() => setShowNewForm(false)} />}
        <InjuryList athleteId={athlete.id} />
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
          <Label className="text-xs">Tap the general area (optional — for the icon shown in your injury list)</Label>
          <div className="mt-2">
            <BodyMapPicker value={region} onChange={setRegion} />
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

  const active = injuries.filter((i) => i.status !== "resolved");
  const resolved = injuries.filter((i) => i.status === "resolved");

  return (
    <div className="space-y-4">
      {active.length === 0 && resolved.length === 0 && (
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

  // Healthcare provider tracking — who, and when the next appointment is.
  // Seeded from the injury row, saved independently of the details edit
  // above since this changes far more often (a new appointment gets
  // booked) than the original details do.
  const [seeingHcp, setSeeingHcp] = useState<boolean>(!!injury.seeing_hcp);
  const [hcpName, setHcpName] = useState<string>(injury.hcp_name ?? "");
  const [nextApptAt, setNextApptAt] = useState<string>(injury.next_appt_at ? String(injury.next_appt_at).slice(0, 16) : "");
  const [savingHcp, setSavingHcp] = useState(false);
  const [addingToDiary, setAddingToDiary] = useState(false);

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

  // Whether this injury already has a diary entry linked to it — checked
  // via the injury_id back-reference on athlete_personal_calendar_entries,
  // not a local flag, so it stays correct even after navigating away and
  // back (and reflects an entry created from the diary side too — see
  // PersonalEntryDialog's "Related injury" field there).
  const { data: linkedAppt } = useQuery({
    queryKey: ["injury-linked-appt", injury.id],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_personal_calendar_entries" as any)
        .select("id, specific_date, start_time")
        .eq("injury_id", injury.id)
        .order("specific_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as any) ?? null;
    },
  });

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

  async function saveHcp() {
    setSavingHcp(true);
    const { error } = await supabase
      .from("injuries")
      .update({
        seeing_hcp: seeingHcp,
        hcp_name: seeingHcp ? (hcpName || null) : null,
        next_appt_at: seeingHcp && nextApptAt ? new Date(nextApptAt).toISOString() : null,
      } as any)
      .eq("id", injury.id);
    setSavingHcp(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Saved");
    qc.invalidateQueries({ queryKey: ["injuries", athleteId] });
  }

  // Creates a linked appointment on the athlete's own diary (My Schedule).
  // The reverse direction — booking or editing an appointment there and
  // tagging it with this injury — writes next_appt_at back onto this row
  // from that side (see PersonalEntryDialog), so either surface can be
  // the one someone actually uses.
  async function addToDiary() {
    if (!nextApptAt) {
      toast.error("Set a next appointment date/time first");
      return;
    }
    setAddingToDiary(true);
    const specificDate = nextApptAt.slice(0, 10);
    const startTime = nextApptAt.slice(11, 16);
    const { error } = await supabase.from("athlete_personal_calendar_entries" as any).insert({
      athlete_id: athleteId,
      category: "appointment",
      title: `${hcpName || "Healthcare"} — ${injury.body_part}`,
      specific_date: specificDate,
      start_time: startTime,
      notes: `Linked to injury: ${injury.body_part}`,
      injury_id: injury.id,
    } as any);
    setAddingToDiary(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Added to your diary");
    qc.invalidateQueries({ queryKey: ["injury-linked-appt", injury.id] });
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
            <BodyMapIcon region={injury.body_region} size="lg" />
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
              <BodyMapPicker value={eRegion} onChange={setERegion} />
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

          <div className="flex flex-wrap gap-2">
            {(["active", "monitoring", "resolved"] as const).map((s) => (
              <Button key={s} size="sm" variant={injury.status === s ? "default" : "outline"} onClick={() => setStatus(s)}>
                {STATUS_LABEL[s]}
              </Button>
            ))}
          </div>

          <div className="border-t pt-3 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Healthcare provider</div>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-normal">Seeing a healthcare provider?</Label>
              <Switch checked={seeingHcp} onCheckedChange={setSeeingHcp} />
            </div>
            {seeingHcp && (
              <div className="space-y-2">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Who</Label>
                    <Input value={hcpName} onChange={(e) => setHcpName(e.target.value)} placeholder="e.g. Dr. Patel, sports physio" />
                  </div>
                  <div>
                    <Label className="text-xs">Next appointment</Label>
                    <Input type="datetime-local" value={nextApptAt} onChange={(e) => setNextApptAt(e.target.value)} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={saveHcp} disabled={savingHcp}>{savingHcp ? "Saving…" : "Save"}</Button>
                  {linkedAppt ? (
                    <span className="text-xs text-muted-foreground">Already on your diary →{" "}
                      <Link to="/app/my-schedule" className="underline">View</Link>
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" onClick={addToDiary} disabled={addingToDiary || !nextApptAt}>
                      {addingToDiary ? "Adding…" : "Add to diary"}
                    </Button>
                  )}
                </div>
              </div>
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
