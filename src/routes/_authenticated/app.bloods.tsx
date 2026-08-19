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
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { todayISO } from "@/lib/format";
import { toast } from "sonner";
import { Trash2, Droplet, Plus, ChevronDown, ChevronUp, TrendingUp } from "lucide-react";
import { BucketTabStrip, healthTabsFor } from "@/components/bucket-tab-strip";
import { AthleteSubnav } from "@/components/athlete-subnav";
import { CoachAthletePicker } from "@/components/coach-athlete-picker";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceArea } from "recharts";
import {
  BLOOD_MARKERS,
  BLOOD_MARKER_CATEGORY_LABEL,
  findMarker,
  flagAgainstRange,
  positionInRange,
  RANGE_FLAG_LABEL,
  type RangeFlag,
} from "@/lib/blood-markers";
import { cn } from "@/lib/utils";

const searchSchema = z.object({ athleteId: z.string().optional() });

export const Route = createFileRoute("/_authenticated/app/bloods")({
  validateSearch: searchSchema,
  component: BloodsPage,
});

// ----------------------------------------------------------------------------
// Blood results.
//
// Kept apart from the injury/illness record on purpose. A blood result is not
// a problem someone has — it is a measurement taken on a date, whose meaning
// comes from its trend rather than from a status. Low ferritin might sit
// quietly below range for a year while an athlete trains normally.
//
// Nothing on this page interprets a value. Flags come from the range the LAB
// printed on that report, stored per result, and where a report carried no
// range the page says so rather than substituting one. Reference ranges vary
// by lab, assay, sex and age, and "optimal for endurance athletes" figures are
// contested clinical opinion — presenting either as the app's answer would be
// showing a judgement as a measurement.
// ----------------------------------------------------------------------------

const FLAG_STYLE: Record<RangeFlag, string> = {
  low: "text-amber-600 dark:text-amber-500",
  high: "text-amber-600 dark:text-amber-500",
  in_range: "text-muted-foreground",
  no_range: "text-muted-foreground",
};

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function BloodsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const { isCoachView } = useEffectiveRole();
  const { data: myAthlete } = useMyAthlete();

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
    queryKey: ["bloods-athlete", selectedAthleteId],
    enabled: !!selectedAthleteId,
    queryFn: async () => {
      const { data, error } = await supabase.from("athletes").select("id, name").eq("id", selectedAthleteId!).single();
      if (error) throw error;
      return data as any;
    },
  });

  const [showNew, setShowNew] = useState(false);

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
      <div className="space-y-6 max-w-4xl">
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

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-[var(--accent-red)]/10 grid place-items-center shrink-0">
              <Droplet className="h-5 w-5 text-[var(--accent-red)]" />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Health &amp; Vitals
              </div>
              <h1 className="text-2xl font-bold">Blood Results</h1>
            </div>
          </div>
          <Button size="sm" onClick={() => setShowNew((v) => !v)}>
            <Plus className="h-4 w-4 mr-1" /> {showNew ? "Cancel" : "Add results"}
          </Button>
        </div>

        <BucketTabStrip items={healthTabsFor(selectedAthleteId)} active="/app/bloods" />

        {showNew && <NewPanelForm athleteId={selectedAthleteId} onSaved={() => setShowNew(false)} />}

        <MarkerTrend athleteId={selectedAthleteId} />
        <PanelList athleteId={selectedAthleteId} />
      </div>
    </AppShell>
  );
}

// ----------------------------------------------------------------------------

interface DraftRow {
  marker: string;
  value: string;
  unit: string;
  refLow: string;
  refHigh: string;
}

function blankRow(): DraftRow {
  return { marker: "", value: "", unit: "", refLow: "", refHigh: "" };
}

function NewPanelForm({ athleteId, onSaved }: { athleteId: string; onSaved: () => void }) {
  const qc = useQueryClient();
  const [takenOn, setTakenOn] = useState(todayISO());
  const [labName, setLabName] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([blankRow()]);
  const [saving, setSaving] = useState(false);

  function setRow(i: number, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  /** Picking a known marker fills its usual unit — still editable, since labs differ. */
  function pickMarker(i: number, name: string) {
    const def = findMarker(name);
    setRow(i, { marker: name, unit: def?.unit ?? rows[i].unit });
  }

  async function save() {
    const usable = rows.filter((r) => r.marker.trim() && r.value.trim() !== "" && Number.isFinite(Number(r.value)));
    if (usable.length === 0) {
      toast.error("Add at least one marker with a value");
      return;
    }
    setSaving(true);

    const { data: panel, error: panelErr } = await (supabase as any)
      .from("blood_panels")
      .insert({
        athlete_id: athleteId,
        taken_on: takenOn,
        lab_name: labName.trim() || null,
        reason: reason.trim() || null,
        notes: notes.trim() || null,
      })
      .select("id")
      .single();

    if (panelErr || !panel) {
      setSaving(false);
      toast.error(panelErr?.message ?? "Could not save");
      return;
    }

    const { error: rowsErr } = await (supabase as any).from("blood_results").insert(
      usable.map((r) => ({
        panel_id: panel.id,
        athlete_id: athleteId,
        marker: r.marker.trim(),
        value: Number(r.value),
        unit: r.unit.trim() || "—",
        // Blank means the report gave no bound, which is different from zero.
        // Coercing an empty box to 0 would invent a lower bound and make every
        // value look comfortably in range.
        ref_low: r.refLow.trim() === "" ? null : Number(r.refLow),
        ref_high: r.refHigh.trim() === "" ? null : Number(r.refHigh),
      })),
    );
    setSaving(false);

    if (rowsErr) {
      // The panel exists but is empty. Said plainly rather than reported as a
      // clean save — an empty panel in the list with no explanation is worse
      // than an error.
      toast.error(`Panel saved but the results did not: ${rowsErr.message}`);
      return;
    }

    toast.success(`${usable.length} result${usable.length === 1 ? "" : "s"} saved`);
    qc.invalidateQueries({ queryKey: ["blood-panels", athleteId] });
    qc.invalidateQueries({ queryKey: ["blood-markers-available", athleteId] });
    onSaved();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New results</CardTitle>
        <CardDescription>
          Enter the reference range as printed on the report. Ranges differ between labs, so the one on your report is
          the one that applies — nothing here fills them in for you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Date taken</Label>
            <Input type="date" value={takenOn} max={todayISO()} onChange={(e) => setTakenOn(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Lab (optional)</Label>
            <Input value={labName} onChange={(e) => setLabName(e.target.value)} placeholder="e.g. Australian Clinical Labs" />
          </div>
          <div>
            <Label className="text-xs">Reason (optional)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Routine / chasing fatigue" />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Markers</Label>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_5rem_4.5rem_4.5rem_4.5rem_2rem] gap-1.5 items-end">
              <div>
                {i === 0 && <Label className="text-[10px] text-muted-foreground">Marker</Label>}
                <Input
                  list="blood-marker-list"
                  value={r.marker}
                  onChange={(e) => pickMarker(i, e.target.value)}
                  placeholder="Ferritin"
                  className="h-8 text-xs"
                />
              </div>
              <div>
                {i === 0 && <Label className="text-[10px] text-muted-foreground">Value</Label>}
                <Input
                  type="number"
                  step="any"
                  value={r.value}
                  onChange={(e) => setRow(i, { value: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                {i === 0 && <Label className="text-[10px] text-muted-foreground">Unit</Label>}
                <Input value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value })} className="h-8 text-xs" />
              </div>
              <div>
                {i === 0 && <Label className="text-[10px] text-muted-foreground">Ref low</Label>}
                <Input
                  type="number"
                  step="any"
                  value={r.refLow}
                  onChange={(e) => setRow(i, { refLow: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                {i === 0 && <Label className="text-[10px] text-muted-foreground">Ref high</Label>}
                <Input
                  type="number"
                  step="any"
                  value={r.refHigh}
                  onChange={(e) => setRow(i, { refHigh: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={() => setRows((p) => (p.length === 1 ? [blankRow()] : p.filter((_, idx) => idx !== i)))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <datalist id="blood-marker-list">
            {BLOOD_MARKERS.map((m) => (
              <option key={m.name} value={m.name}>
                {BLOOD_MARKER_CATEGORY_LABEL[m.category]}
              </option>
            ))}
          </datalist>
          <Button size="sm" variant="outline" onClick={() => setRows((p) => [...p, blankRow()])}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add marker
          </Button>
        </div>

        <Textarea placeholder="Notes on this panel" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Button onClick={save} disabled={saving} className="w-full">
          {saving ? "Saving…" : "Save results"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------

function MarkerTrend({ athleteId }: { athleteId: string }) {
  const [marker, setMarker] = useState<string>("");

  const { data: available = [] } = useQuery({
    queryKey: ["blood-markers-available", athleteId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("blood_results")
        .select("marker")
        .eq("athlete_id", athleteId);
      return Array.from(new Set((data ?? []).map((r: any) => r.marker))).sort() as string[];
    },
  });

  const { data: series = [] } = useQuery({
    queryKey: ["blood-trend", athleteId, marker],
    enabled: !!marker,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("blood_results")
        .select("value, unit, ref_low, ref_high, blood_panels(taken_on)")
        .eq("athlete_id", athleteId)
        .eq("marker", marker);
      return ((data ?? []) as any[])
        .map((r) => ({
          date: r.blood_panels?.taken_on as string,
          value: Number(r.value),
          unit: r.unit,
          refLow: r.ref_low == null ? null : Number(r.ref_low),
          refHigh: r.ref_high == null ? null : Number(r.ref_high),
        }))
        .filter((r) => !!r.date && Number.isFinite(r.value))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
    },
  });

  useEffect(() => {
    if (!marker && available.length > 0) setMarker(available[0]);
  }, [available, marker]);

  if (available.length === 0) return null;

  // The band is drawn from the MOST RECENT reading's range, and only when
  // every reading in the series agrees on it. A band assembled from readings
  // whose labs disagreed would draw one authoritative-looking rectangle across
  // measurements it does not apply to.
  const ranges = series.filter((s) => s.refLow != null && s.refHigh != null);
  const consistentRange =
    ranges.length > 0 &&
    ranges.every((s) => s.refLow === ranges[0].refLow && s.refHigh === ranges[0].refHigh)
      ? ranges[0]
      : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4" /> Trend
          </CardTitle>
          <Select value={marker} onValueChange={setMarker}>
            <SelectTrigger className="w-52 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {available.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {series.length < 2 ? (
          <p className="text-xs text-muted-foreground">
            Only one reading for {marker} so far — a trend needs at least two.
          </p>
        ) : (
          <>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  {consistentRange && (
                    <ReferenceArea
                      y1={consistentRange.refLow!}
                      y2={consistentRange.refHigh!}
                      fill="#34d399"
                      fillOpacity={0.12}
                    />
                  )}
                  <XAxis dataKey="date" tickFormatter={(d) => fmtDate(d)} fontSize={10} />
                  <YAxis fontSize={10} width={40} domain={["auto", "auto"]} />
                  <Tooltip
                    labelFormatter={(d) => fmtDate(String(d))}
                    formatter={(v: any) => [`${v} ${series[0]?.unit ?? ""}`, marker]}
                  />
                  <Line type="monotone" dataKey="value" stroke="var(--accent-red)" strokeWidth={2} dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              {consistentRange
                ? "Shaded band is the reference range from the report."
                : ranges.length > 0
                  ? "No band drawn — the reports in this series quote different reference ranges, so no single band applies to all of them."
                  : "No band drawn — no reference range was recorded for these readings."}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------

function PanelList({ athleteId }: { athleteId: string }) {
  const { data: panels } = useQuery({
    queryKey: ["blood-panels", athleteId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("blood_panels")
        .select("*, blood_results(*)")
        .eq("athlete_id", athleteId)
        .order("taken_on", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  if (!panels) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (panels.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No blood results recorded yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {panels.map((p) => (
        <PanelCard key={p.id} panel={p} athleteId={athleteId} />
      ))}
    </div>
  );
}

function PanelCard({ panel, athleteId }: { panel: any; athleteId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);

  const results = (panel.blood_results ?? []) as any[];
  const outOfRange = results.filter((r) => {
    const f = flagAgainstRange(Number(r.value), r.ref_low, r.ref_high);
    return f === "low" || f === "high";
  });

  async function remove() {
    if (!confirm("Delete this panel and all its results?")) return;
    const { error } = await (supabase as any).from("blood_panels").delete().eq("id", panel.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Panel deleted");
    qc.invalidateQueries({ queryKey: ["blood-panels", athleteId] });
    qc.invalidateQueries({ queryKey: ["blood-markers-available", athleteId] });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 text-left min-w-0">
            {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            <div className="min-w-0">
              <CardTitle className="text-base">{fmtDate(panel.taken_on)}</CardTitle>
              <CardDescription className="truncate">
                {results.length} marker{results.length === 1 ? "" : "s"}
                {panel.lab_name && ` · ${panel.lab_name}`}
                {panel.reason && ` · ${panel.reason}`}
              </CardDescription>
            </div>
          </button>
          <div className="flex items-center gap-2 shrink-0">
            {outOfRange.length > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {outOfRange.length} outside lab range
              </Badge>
            )}
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={remove}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-1.5">
          {results.map((r) => {
            const value = Number(r.value);
            const flag = flagAgainstRange(value, r.ref_low, r.ref_high);
            const pos = positionInRange(value, r.ref_low, r.ref_high);
            return (
              <div key={r.id} className="flex items-center gap-3 text-xs">
                <span className="w-40 shrink-0 truncate font-medium">{r.marker}</span>
                <span className="w-24 shrink-0 tabular-nums">
                  {value} <span className="text-muted-foreground">{r.unit}</span>
                </span>
                <div className="min-w-0 flex-1">
                  {pos != null ? (
                    <div className="h-1.5 rounded-full bg-muted relative">
                      <div className="absolute inset-y-0 left-0 right-0 rounded-full bg-emerald-500/25" />
                      <div
                        className="absolute top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full bg-foreground -ml-1"
                        style={{ left: `${pos}%` }}
                      />
                    </div>
                  ) : (
                    <div className="h-1.5 rounded-full bg-muted" />
                  )}
                </div>
                <span className="w-32 shrink-0 text-right text-[11px] text-muted-foreground">
                  {r.ref_low != null || r.ref_high != null
                    ? `${r.ref_low ?? "—"}–${r.ref_high ?? "—"}`
                    : "no range given"}
                </span>
                <span className={cn("w-28 shrink-0 text-right text-[11px]", FLAG_STYLE[flag])}>
                  {RANGE_FLAG_LABEL[flag]}
                </span>
              </div>
            );
          })}
          {panel.notes && <p className="text-xs text-muted-foreground pt-2">{panel.notes}</p>}
          <p className="text-[11px] text-muted-foreground pt-2">
            Flags compare each value against the range recorded for it, which is the range that lab printed. They are
            not a clinical interpretation — that is a conversation for whoever ordered the test.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
