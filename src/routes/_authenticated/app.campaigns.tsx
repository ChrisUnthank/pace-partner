import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Flag, Plus, Trash2, Target, CalendarRange, Sparkles } from "lucide-react";
import { BucketTabStrip, COACHING_HUB_TABS } from "@/components/bucket-tab-strip";
import { CampaignTimeline, PRIORITY_STYLE } from "@/components/campaign-timeline";
import { generateCampaign, type CampaignTarget, type TargetPriority } from "@/lib/campaign-generator";
import { useMyRoles, useMyAthlete } from "@/lib/use-auth";

export const Route = createFileRoute("/_authenticated/app/campaigns")({
  component: CampaignsPage,
});

const PRIORITIES: { value: TargetPriority; label: string; help: string }[] = [
  { value: "peak", label: "Peak", help: "The season's target. Full taper, and the campaign's highest load leads into it." },
  { value: "key", label: "Key", help: "Races that matter — State champs and similar. Short taper." },
  { value: "tune_up", label: "Tune-up", help: "A few days easier. No taper week." },
  { value: "training", label: "Training", help: "Raced through. Volume held; adjust the week's sessions away from lactic work." },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function CampaignsPage() {
  const qc = useQueryClient();
  const { data: roles = [] } = useMyRoles();
  const { data: myAthlete } = useMyAthlete();
  const isCoach = roles.includes("coach");

  const [selectedAthleteId, setSelectedAthleteId] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);

  const { data: roster, isError: rosterError } = useQuery({
    queryKey: ["campaign-roster", isCoach],
    enabled: isCoach,
    queryFn: async () => {
      const { data, error } = await supabase.from("athletes").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const athleteId = selectedAthleteId || myAthlete?.id || roster?.[0]?.id || "";

  const { data: campaigns, isLoading, isError, error } = useQuery({
    queryKey: ["campaigns", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("campaigns")
        .select("*, campaign_targets(*), campaign_blocks(*), campaign_weeks(*)")
        .eq("athlete_id", athleteId)
        .order("starts_on", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-[var(--accent-red)]/10 p-2">
            <Target className="h-5 w-5 text-[var(--accent-red)]" />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Coaching Hub</div>
            <h1 className="text-2xl font-bold">Campaigns</h1>
          </div>
        </div>

        <BucketTabStrip items={COACHING_HUB_TABS} />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">The plan above the plan.</CardTitle>
            <CardDescription>
              A campaign lays out the whole stretch from the last season's break to the race that matters: the phases,
              the loading rhythm, where the peak sits, how long each taper runs. It works with the time you actually
              have. Every number is a starting point and all of it is yours to edit.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="font-medium mb-1">Built around your races</div>
              <p className="text-xs text-muted-foreground">
                Mark which races matter and which are raced through. A club race during a base block stays a base
                block — only the races you flag as peaks reshape the season around them.
              </p>
            </div>
            <div>
              <div className="font-medium mb-1">Structure, not sessions</div>
              <p className="text-xs text-muted-foreground">
                A campaign proposes phases and weekly load, nothing more. Fill a block from a plan template when you
                reach it, or fill the whole season up front — both work.
              </p>
            </div>
            <div>
              <div className="font-medium mb-1">Nothing is locked</div>
              <p className="text-xs text-muted-foreground">
                Change any week and it stays changed. Regenerating re-proposes only the weeks you haven't touched, and
                tells you which it left alone.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          {isCoach && (roster?.length ?? 0) > 0 && (
            <Select value={athleteId} onValueChange={setSelectedAthleteId}>
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="Choose an athlete" />
              </SelectTrigger>
              <SelectContent>
                {(roster ?? []).map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {rosterError && (
            <p className="text-xs text-destructive">Couldn't load the athlete list.</p>
          )}
          <Button onClick={() => setCreateOpen(true)} disabled={!athleteId}>
            <Plus className="h-4 w-4 mr-1.5" /> New campaign
          </Button>
        </div>

        {/* A page with a loading state and an empty state but no ERROR state
            hides its own failures — a query that keeps retrying reads as
            "still loading" forever, and one that fails outright reads as
            "no campaigns yet". Both are wrong and neither is debuggable from
            the screen. */}
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {isError && (
          <Card>
            <CardContent className="py-6 space-y-2">
              <p className="text-sm text-destructive">Couldn't load campaigns.</p>
              <p className="text-xs text-muted-foreground font-mono break-all">
                {(error as any)?.message ?? "Unknown error"}
              </p>
              <p className="text-xs text-muted-foreground">
                If this mentions a relationship or a missing column, the campaign migrations may not have been run
                against this database yet.
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !isError && !athleteId && (
          <Card>
            <CardContent className="py-6">
              <p className="text-sm text-muted-foreground">
                No athlete selected. {isCoach ? "Choose one above to see their campaigns." : "This account isn't linked to an athlete profile."}
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !isError && athleteId && (campaigns?.length ?? 0) === 0 && (
          <Card>
            <CardContent className="py-10 text-center space-y-2">
              <Sparkles className="h-6 w-6 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No campaigns yet. Add the races that matter and see the season laid out.
              </p>
            </CardContent>
          </Card>
        )}

        {(campaigns ?? []).map((c: any) => (
          <SavedCampaign key={c.id} campaign={c} onChanged={() => qc.invalidateQueries({ queryKey: ["campaigns", athleteId] })} />
        ))}
      </div>

      <CreateCampaignDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        athleteId={athleteId}
        onCreated={() => {
          setCreateOpen(false);
          qc.invalidateQueries({ queryKey: ["campaigns", athleteId] });
        }}
      />
    </AppShell>
  );
}

function SavedCampaign({ campaign, onChanged }: { campaign: any; onChanged: () => void }) {
  const weeks = useMemo(
    () =>
      [...(campaign.campaign_weeks ?? [])]
        .sort((a: any, b: any) => a.week_number - b.week_number)
        .map((w: any) => ({
          weekNumber: w.week_number,
          weekStart: w.week_start,
          phase: (campaign.campaign_blocks ?? []).find((b: any) => b.id === w.block_id)?.phase ?? "base",
          loadPct: Number(w.load_pct),
          isDeload: w.is_deload,
          isLocked: w.is_locked,
          id: w.id,
          raceName:
            (campaign.campaign_targets ?? []).find((t: any) => {
              const d = new Date(`${t.race_date}T00:00:00`);
              const s = new Date(`${w.week_start}T00:00:00`);
              return d >= s && d < new Date(s.getTime() + 7 * 86400000);
            })?.name ?? null,
          racePriority:
            (campaign.campaign_targets ?? []).find((t: any) => {
              const d = new Date(`${t.race_date}T00:00:00`);
              const s = new Date(`${w.week_start}T00:00:00`);
              return d >= s && d < new Date(s.getTime() + 7 * 86400000);
            })?.priority ?? null,
        })),
    [campaign],
  );

  const blocks = useMemo(
    () =>
      [...(campaign.campaign_blocks ?? [])]
        .sort((a: any, b: any) => a.block_order - b.block_order)
        .map((b: any) => ({
          blockOrder: b.block_order,
          phase: b.phase,
          label: b.label ?? b.phase,
          startsOn: b.starts_on,
          endsOn: b.ends_on,
          weeks: Math.round(
            (new Date(`${b.ends_on}T00:00:00`).getTime() - new Date(`${b.starts_on}T00:00:00`).getTime()) /
              (7 * 86400000),
          ) + 1,
        })),
    [campaign],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-[var(--accent-red)]" />
            {campaign.name}
          </CardTitle>
          <Badge variant={campaign.status === "active" ? "default" : "secondary"}>{campaign.status}</Badge>
        </div>
        <CardDescription>
          {campaign.starts_on} → {campaign.ends_on} · {weeks.length} weeks ·{" "}
          {(campaign.campaign_targets ?? []).length} race
          {(campaign.campaign_targets ?? []).length === 1 ? "" : "s"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CampaignTimeline weeks={weeks as any} blocks={blocks as any} />
      </CardContent>
    </Card>
  );
}

function CreateCampaignDialog({
  open,
  onOpenChange,
  athleteId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  athleteId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState(todayIso());
  const [resetWeeks, setResetWeeks] = useState(2);
  const [loadWeeks, setLoadWeeks] = useState(3);
  const [deloadWeeks, setDeloadWeeks] = useState(1);
  const [deloadsEnabled, setDeloadsEnabled] = useState(true);
  const [taperWeeks, setTaperWeeks] = useState(2);
  const [keyTaperWeeks, setKeyTaperWeeks] = useState(1);
  const [raceWeekReduction, setRaceWeekReduction] = useState(15);
  const [targets, setTargets] = useState<CampaignTarget[]>([]);
  const [saving, setSaving] = useState(false);

  // Live preview. The whole point of the create flow is seeing the shape
  // before committing to it — a coach can tell in one glance whether a taper
  // is too long or a base block too short, and that judgement is much harder
  // to make from a form full of numbers.
  const preview = useMemo(
    () =>
      generateCampaign({
        startsOn,
        loadWeeks,
        deloadWeeks,
        deloadsEnabled,
        taperWeeks,
        keyTaperWeeks,
        resetWeeks,
        postPeakRecoveryWeeks: 1,
        transitionWeeks: 0,
        targets,
        loads: { raceWeekReduction },
      }),
    [startsOn, loadWeeks, deloadWeeks, deloadsEnabled, taperWeeks, keyTaperWeeks, resetWeeks, targets, raceWeekReduction],
  );

  function addTarget() {
    setTargets((t) => [...t, { raceDate: todayIso(), name: "", priority: "training" }]);
  }

  async function save() {
    if (!name.trim()) return toast.error("Give the campaign a name.");
    if (targets.length === 0) return toast.error("Add at least one race.");
    if (preview.weeks.length === 0) return toast.error(preview.notes[0] ?? "Nothing to save.");

    setSaving(true);
    try {
      const endsOn = preview.weeks[preview.weeks.length - 1].weekStart;
      const { data: campaign, error: cErr } = await (supabase as any)
        .from("campaigns")
        .insert({
          athlete_id: athleteId,
          name: name.trim(),
          starts_on: preview.weeks[0].weekStart,
          ends_on: endsOn,
          load_weeks: loadWeeks,
          deload_weeks: deloadWeeks,
          deloads_enabled: deloadsEnabled,
          taper_weeks: taperWeeks,
          key_taper_weeks: keyTaperWeeks,
          reset_weeks: resetWeeks,
          transition_weeks: 0,
          race_week_reduction_pct: raceWeekReduction,
          status: "draft",
        })
        .select()
        .single();
      if (cErr) throw cErr;

      const { error: tErr } = await (supabase as any).from("campaign_targets").insert(
        targets.map((t) => ({
          campaign_id: campaign.id,
          race_date: t.raceDate,
          name: t.name || null,
          priority: t.priority,
        })),
      );
      if (tErr) throw tErr;

      const { data: savedBlocks, error: bErr } = await (supabase as any)
        .from("campaign_blocks")
        .insert(
          preview.blocks.map((b) => ({
            campaign_id: campaign.id,
            block_order: b.blockOrder,
            phase: b.phase,
            label: b.label,
            starts_on: b.startsOn,
            ends_on: b.endsOn,
          })),
        )
        .select();
      if (bErr) throw bErr;

      // Weeks carry block_id so the saved campaign renders exactly as the
      // preview did, rather than re-deriving phase from dates on read.
      const blockFor = (weekStart: string) =>
        (savedBlocks ?? []).find((b: any) => b.starts_on <= weekStart && b.ends_on >= weekStart)?.id ?? null;

      const { error: wErr } = await (supabase as any).from("campaign_weeks").insert(
        preview.weeks.map((w) => ({
          campaign_id: campaign.id,
          block_id: blockFor(w.weekStart),
          week_number: w.weekNumber,
          week_start: w.weekStart,
          load_pct: w.loadPct,
          is_deload: w.isDeload,
        })),
      );
      if (wErr) throw wErr;

      toast.success("Campaign created");
      onCreated();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't create the campaign.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto brand-scrollbar">
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>
            Add the races and set the rhythm. The shape updates as you go — nothing is saved until you say so.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="2026/27 track season" />
            </div>
            <div>
              <Label className="text-xs">Starts</Label>
              <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs">Races</Label>
              <Button size="sm" variant="outline" onClick={addTarget}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add race
              </Button>
            </div>
            {targets.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Add at least one. Mark the race that matters most as a Peak — without one, no taper is built in.
              </p>
            )}
            <div className="space-y-2">
              {targets.map((t, i) => (
                <div key={i} className="flex items-center gap-2 flex-wrap">
                  <Input
                    type="date"
                    className="w-[150px]"
                    value={t.raceDate}
                    onChange={(e) =>
                      setTargets((arr) => arr.map((x, k) => (k === i ? { ...x, raceDate: e.target.value } : x)))
                    }
                  />
                  <Input
                    className="flex-1 min-w-[140px]"
                    placeholder="Race name"
                    value={t.name ?? ""}
                    onChange={(e) => setTargets((arr) => arr.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))}
                  />
                  <Select
                    value={t.priority}
                    onValueChange={(v) =>
                      setTargets((arr) => arr.map((x, k) => (k === i ? { ...x, priority: v as TargetPriority } : x)))
                    }
                  >
                    <SelectTrigger className="w-[130px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="h-2 w-2 rounded-full inline-block"
                              style={{ background: PRIORITY_STYLE[p.value].fill }}
                            />
                            {p.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="icon" variant="ghost" onClick={() => setTargets((arr) => arr.filter((_, k) => k !== i))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            {targets.length > 0 && (
              <p className="text-[11px] text-muted-foreground mt-2">
                {PRIORITIES.map((p) => `${p.label}: ${p.help}`).join(" ")}
              </p>
            )}
          </div>

          <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <NumField label="Down weeks" value={resetWeeks} onChange={setResetWeeks} min={0} max={8} />
            <NumField label="Load weeks" value={loadWeeks} onChange={setLoadWeeks} min={1} max={6} />
            <NumField label="Deload weeks" value={deloadWeeks} onChange={setDeloadWeeks} min={0} max={2} />
            <NumField label="Peak taper" value={taperWeeks} onChange={setTaperWeeks} min={0} max={4} />
            <NumField label="Key taper" value={keyTaperWeeks} onChange={setKeyTaperWeeks} min={0} max={3} />
            <NumField label="Race wk −%" value={raceWeekReduction} onChange={setRaceWeekReduction} min={0} max={50} />
          </div>

          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={deloadsEnabled} onChange={(e) => setDeloadsEnabled(e.target.checked)} />
            Deload on a fixed rhythm. Off means loading runs continuously and you add recovery yourself.
          </label>

          {preview.weeks.length > 0 && (
            <div className="border rounded-lg p-3">
              <div className="text-xs font-medium mb-2">
                {preview.weeks.length} weeks · {preview.blocks.length} blocks
              </div>
              <CampaignTimeline weeks={preview.weeks} blocks={preview.blocks} />
            </div>
          )}

          {preview.notes.map((n, i) => (
            <p key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <Flag className="h-3 w-3 shrink-0 mt-0.5" /> {n}
            </p>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || preview.weeks.length === 0}>
            {saving ? "Creating…" : "Create campaign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NumField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div>
      <Label className="text-[11px]">{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
        className="h-8"
      />
    </div>
  );
}
