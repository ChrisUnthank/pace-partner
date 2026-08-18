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
import { CalendarRange, ChevronRight, Flag, Plus, Sparkles, Target, Trash2 } from "lucide-react";
import { BucketTabStrip, COACHING_HUB_TABS } from "@/components/bucket-tab-strip";
import { CampaignTimeline, PRIORITY_STYLE } from "@/components/campaign-timeline";
import { WeekEditDialog, BaselineDialog } from "@/components/campaign-week-edit";
import { EditCampaignDialog } from "@/components/campaign-edit";
import { AddRacesPanel } from "@/components/campaign-race-picker";
import { generateCampaign, type CampaignTarget, type TargetPriority, isValidIsoDate, deriveTaperFloor } from "@/lib/campaign-generator";
import { useMyRoles, useMyAthlete, useAuthUser } from "@/lib/use-auth";

export const Route = createFileRoute("/_authenticated/app/campaign")({
  component: CampaignsPage,
});

const PRIORITIES: { value: TargetPriority; label: string; help: string }[] = [
  {
    value: "peak",
    label: "Peak",
    // Describes the ATHLETE'S state, which is what the word means to a coach,
    // rather than the mechanics it triggers.
    help: "The race you want to be in form for. Gets the full taper, with the season's heaviest training block leading into it.",
  },
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
  const { user } = useAuthUser();
  const isCoach = roles.includes("coach");
  const isManager = roles.includes("manager");

  const [selectedAthleteId, setSelectedAthleteId] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  // One expanded at a time. A page of full timelines is a lot of screen for
  // something you are usually scanning past.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFinished, setShowFinished] = useState(false);

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

  // EVERY campaign the viewer can see, not just the selected athlete's.
  //
  // Filtering by the athlete dropdown meant a coach had to know which athlete
  // a campaign belonged to before they could find it — the wrong way round,
  // since the campaign is the thing you're looking for and the athlete is one
  // of its attributes. RLS already scopes this to athletes the viewer can
  // access, so no athlete filter is needed to keep it safe.
  //
  // The dropdown stays, but only to choose who a NEW campaign is for.
  const { data: campaigns, isLoading, isError, error } = useQuery({
    queryKey: ["campaigns", "all"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("campaigns")
        .select("*, athletes(name), campaign_targets(*), campaign_blocks(*), campaign_weeks(*)")
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

        {/* COACHING_HUB_TABS is now empty — Coaching moved to a grouped
            sidebar bucket, and BucketTabStrip renders nothing at length <= 1.
            Left in place rather than removing the import, so this file isn't
            touched again while the GitHub sync is unreliable. */}
        <BucketTabStrip items={COACHING_HUB_TABS} active="/app/campaign" />

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
                {/* Only decides who a NEW campaign is for — the list below
                    shows every athlete's. */}
                <SelectValue placeholder="New campaign for…" />
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
          {(isCoach || isManager || athleteId === myAthlete?.id) && (
            <Button onClick={() => setCreateOpen(true)} disabled={!athleteId}>
              <Plus className="h-4 w-4 mr-1.5" /> New campaign
            </Button>
          )}
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



        {!isLoading && !isError && (campaigns?.length ?? 0) === 0 && (
          <Card>
            <CardContent className="py-10 text-center space-y-2">
              <Sparkles className="h-6 w-6 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No campaigns yet. Add the races that matter and see the season laid out.
              </p>
            </CardContent>
          </Card>
        )}

        {(() => {
          const all = campaigns ?? [];
          // Complete and abandoned are hidden: a season a year per athlete
          // across a squad buries the live ones fast. Counted, not silently
          // dropped — a list that quietly omits things is worse than a long
          // one.
          const finished = all.filter((c: any) => c.status === "complete" || c.status === "abandoned");
          const live = all.filter((c: any) => c.status !== "complete" && c.status !== "abandoned");
          const shown = showFinished ? all : live;
          return (
            <>
              {shown.map((c: any) => (
                <CampaignRow
                  key={c.id}
                  campaign={c}
                  expanded={expandedId === c.id}
                  onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
                  canWrite={isCoach || isManager || c.created_by === user?.id}
                  onChanged={() => qc.invalidateQueries({ queryKey: ["campaigns", "all"] })}
                />
              ))}
              {finished.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowFinished((v) => !v)}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  {showFinished
                    ? "Hide finished campaigns"
                    : `Show ${finished.length} finished campaign${finished.length === 1 ? "" : "s"}`}
                </button>
              )}
            </>
          );
        })()}
      </div>

      <CreateCampaignDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        athleteId={athleteId}
        onCreated={() => {
          setCreateOpen(false);
          qc.invalidateQueries({ queryKey: ["campaigns", "all"] });
        }}
      />
    </AppShell>
  );
}

/**
 * One campaign as a compact row, expanding to the full timeline.
 *
 * The summary carries what you'd actually scan for — whose it is, how long,
 * how many races, and when the peak falls. Enough to tell two seasons apart
 * without opening either.
 */
function CampaignRow({
  campaign,
  expanded,
  onToggle,
  canWrite,
  onChanged,
}: {
  campaign: any;
  expanded: boolean;
  onToggle: () => void;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const targets = campaign.campaign_targets ?? [];
  const weekCount = (campaign.campaign_weeks ?? []).length;
  const peak = targets
    .filter((t: any) => t.priority === "peak")
    .sort((a: any, b: any) => String(a.race_date).localeCompare(String(b.race_date)))[0];

  return (
    <Card>
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-6 py-3 hover:bg-accent/40 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
          />
          <span className="font-medium">{campaign.athletes?.name ?? "Athlete"}</span>
          <span className="text-sm">{campaign.name}</span>
          <Badge variant={campaign.status === "active" ? "default" : "secondary"} className="text-[10px]">
            {campaign.status}
          </Badge>
          <span className="text-[11px] text-muted-foreground ml-auto">
            {weekCount} wk · {targets.length} race{targets.length === 1 ? "" : "s"}
            {peak ? ` · peak ${peak.race_date}` : " · no peak set"}
          </span>
        </div>
      </button>

      {expanded && <SavedCampaign campaign={campaign} canWrite={canWrite} onChanged={onChanged} />}
    </Card>
  );
}

function SavedCampaign({
  campaign,
  onChanged,
  canWrite,
}: {
  campaign: any;
  onChanged: () => void;
  /** Mirrors the RLS rule: coaches and managers, or the athlete who built it.
   *  Showing controls the database will refuse is worse than hiding them. */
  canWrite: boolean;
}) {
  const [editingWeek, setEditingWeek] = useState<any>(null);
  const [baselineOpen, setBaselineOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const baselineKm = campaign.baseline_weekly_km != null ? Number(campaign.baseline_weekly_km) : null;

  // What actually happened. Derived, never stored — a campaign says what was
  // planned and sessions record what occurred, so storing an "actual" column
  // would mean keeping it in step with every session edit for no benefit.
  const { data: actuals } = useQuery({
    queryKey: ["campaign-actuals", campaign.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_campaign_actuals", { _campaign_id: campaign.id });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const actualByWeek = useMemo(
    () =>
      new Map(
        (actuals ?? []).map((a: any) => [a.week_start, { km: Number(a.actual_km), sessions: Number(a.sessions) }]),
      ),
    [actuals],
  );

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
          // Campaigns created before the rename stored "Peak" as the block
          // label. Remapped on read rather than migrated: it's a display
          // string, and rewriting rows to change a word isn't worth the risk.
          label: b.phase === "peak" ? "Overload" : (b.label ?? b.phase),
          startsOn: b.starts_on,
          endsOn: b.ends_on,
          // COUNT the weeks that belong to this block rather than inferring
          // it from the date span.
          //
          // The old arithmetic was Math.round(days / 7) + 1, and ends_on is
          // the last week's START plus six days — so a 5-week block spans 34
          // days, 34/7 = 4.857 rounds UP to 5, and +1 gave 6. Every block of
          // any length reported one week too many, and flexGrow then sized it
          // for a week that wasn't there, which is why a "6 week" label sat
          // over five bars.
          weeks: (campaign.campaign_weeks ?? []).filter((w: any) => w.block_id === b.id).length,
        })),
    [campaign],
  );

  return (
    // No Card or title here — CampaignRow provides both. Repeating them would
    // put a card inside a card and the name twice.
    <>
      <div className="px-6 pb-3">
        <div className="flex items-center justify-end gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Badge variant={campaign.status === "active" ? "default" : "secondary"}>{campaign.status}</Badge>
            {canWrite && (
              <>
                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>
        {/* Dates only — the row above already carries athlete, status, week
            count and race count. */}
        <p className="text-xs text-muted-foreground">
          {campaign.starts_on} → {campaign.ends_on}
        </p>
      </div>
      <div className="px-6 pb-6 space-y-3">
        <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
          {canWrite ? (
            <>
              <button type="button" onClick={() => setBaselineOpen(true)} className="underline hover:text-foreground">
                {baselineKm ? `Baseline ${baselineKm} km/week` : "Set weekly baseline"}
              </button>
              <span>Click any week to change its load.</span>
            </>
          ) : (
            <>
              {baselineKm && <span>Baseline {baselineKm} km/week</span>}
              <span>Built by your coach — hover any week for its detail.</span>
            </>
          )}
        </div>

        <CampaignTimeline
          weeks={weeks as any}
          blocks={blocks as any}
          baselineKm={baselineKm}
          actualByWeek={actualByWeek as any}
          onWeekClick={canWrite ? (w) => setEditingWeek(w) : undefined}
        />
      </div>

      <WeekEditDialog
        open={!!editingWeek}
        onOpenChange={(v) => !v && setEditingWeek(null)}
        week={editingWeek}
        campaignId={campaign.id}
        baselineKm={baselineKm}
        allWeeks={weeks as any}
        onSaved={onChanged}
      />
      <EditCampaignDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        campaign={campaign}
        onSaved={onChanged}
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this campaign?</DialogTitle>
            <DialogDescription>
              {campaign.name} and its {(campaign.campaign_weeks ?? []).length} weeks will be removed. Sessions and
              training data are untouched — a campaign is structure only.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                const { error } = await (supabase as any).from("campaigns").delete().eq("id", campaign.id);
                if (error) return toast.error(error.message);
                toast.success("Campaign deleted");
                setConfirmDelete(false);
                onChanged();
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BaselineDialog
        open={baselineOpen}
        onOpenChange={setBaselineOpen}
        campaignId={campaign.id}
        current={baselineKm}
        onSaved={onChanged}
      />
    </>
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
  // Taper depth and shape are athlete traits, not universal truths. Some
  // sharpen on a deep taper; others lose fitness across two light weeks and
  // need the floor held higher.
  const [taperFloorPct, setTaperFloorPct] = useState(55);
  const [taperShape, setTaperShape] = useState<"linear" | "gentle" | "steep">("linear");
  const [overloadBefore, setOverloadBefore] = useState(3);
  const [overloadLen, setOverloadLen] = useState(1);
  const [overloadKey, setOverloadKey] = useState(true);
  const [taperStrategy, setTaperStrategy] = useState<"traditional" | "high_response" | "custom">("traditional");
  const [taperFrequencyMode, setTaperFrequencyMode] = useState<"fewer_days" | "same_days_shorter">("fewer_days");
  const [taperNeuro, setTaperNeuro] = useState(false);
  const [taperRestDays, setTaperRestDays] = useState(1);
  const [taperSessionCut, setTaperSessionCut] = useState<"minimal" | "moderate" | "large">("moderate");
  // The percentage follows the structure. Overriding is possible but is a
  // deliberate act, not the default way in.
  const [floorOverride, setFloorOverride] = useState(false);
  const derivedFloor = deriveTaperFloor(taperRestDays, taperSessionCut);

  /**
   * Applying an archetype sets the numbers; changing a number afterwards
   * moves the strategy to "custom".
   *
   * A preset that silently overrode later edits would be worse than no preset
   * — the coach would change the taper length and watch it snap back.
   */
  function applyTaperStrategy(v: "traditional" | "high_response" | "custom") {
    setTaperStrategy(v);
    if (v === "traditional") {
      setTaperDays(17);
      setTaperFloorPct(35);
      setTaperShape("linear");
      setTaperFrequencyMode("fewer_days");
      setTaperNeuro(false);
      setTaperRestDays(2);
      setTaperSessionCut("moderate");
    } else if (v === "high_response") {
      setTaperDays(9);
      setTaperFloorPct(50);
      setTaperShape("gentle");
      setTaperFrequencyMode("same_days_shorter");
      setTaperNeuro(true);
      setTaperRestDays(0);
      setTaperSessionCut("large");
    }
  }
  // Days, not weeks. Coaches taper in days and a Monday grid was distorting
  // it — see the generator for the arithmetic.
  const [taperDays, setTaperDays] = useState(14);
  const [keyTaperDays, setKeyTaperDays] = useState(7);
  const [baseProgression, setBaseProgression] = useState<"progressive" | "flat">("progressive");
  const [buildProgression, setBuildProgression] = useState<"progressive" | "flat">("progressive");
  const [baseQuality, setBaseQuality] = useState(0.5);
  const [buildQuality, setBuildQuality] = useState(2);
  const [raceWeekReduction, setRaceWeekReduction] = useState(15);
  const [targets, setTargets] = useState<CampaignTarget[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
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
        taperFloorPct,
        taperShape,
        overloadWeeksBeforeRace: overloadBefore,
        overloadBlockWeeks: overloadLen,
        overloadBeforeKey: overloadKey,
        taperFrequencyMode,
        taperNeuromuscular: taperNeuro,
        taperRestDaysAdded: taperRestDays,
        taperSessionReduction: taperSessionCut,
        taperFloorOverride: floorOverride,
        taperDays,
        keyTaperDays,
        baseProgression,
        buildProgression,
        baseQualityPerWeek: baseQuality,
        buildQualityPerWeek: buildQuality,
        loads: { raceWeekReduction },
      }),
    [
      startsOn, loadWeeks, deloadWeeks, deloadsEnabled, taperWeeks, keyTaperWeeks,
      resetWeeks, targets, raceWeekReduction, taperFloorPct, taperShape,
      taperDays, keyTaperDays, baseProgression, buildProgression, baseQuality, buildQuality,
      overloadBefore, overloadLen, overloadKey, taperFrequencyMode, taperNeuro,
      taperRestDays, taperSessionCut, floorOverride,
    ],
  );

  function addTarget() {
    setTargets((t) => [...t, { raceDate: todayIso(), name: "", priority: "training" }]);
  }

  async function save() {
    if (!name.trim()) return toast.error("Give the campaign a name.");
    if (targets.some((t) => !isValidIsoDate(t.raceDate)))
      return toast.error("One of the races has an incomplete date.");
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
          taper_floor_pct: floorOverride ? taperFloorPct : derivedFloor,
          taper_shape: taperShape,
          overload_weeks_before_race: overloadBefore,
          overload_block_weeks: overloadLen,
          overload_before_key: overloadKey,
          taper_strategy: taperStrategy,
          taper_frequency_mode: taperFrequencyMode,
          taper_neuromuscular: taperNeuro,
          taper_rest_days_added: taperRestDays,
          taper_session_reduction: taperSessionCut,
          taper_days: taperDays,
          key_taper_days: keyTaperDays,
          base_progression: baseProgression,
          build_progression: buildProgression,
          base_quality_per_week: baseQuality,
          build_quality_per_week: buildQuality,
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
          athlete_goal_id: t.athleteGoalId ?? null,
          race_schedule_entry_id: t.raceScheduleEntryId ?? null,
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
      <DialogContent
        // Near-full-width: the timeline inside is the point of this dialog,
        // and a 30-week season needs the room. Capped at 1400px so it doesn't
        // stretch absurdly on an ultrawide, and vw-based below that so it
        // adapts rather than sitting at a fixed size.
        className="w-[96vw] max-w-[1400px] sm:max-w-[1400px] max-h-[92vh] overflow-y-auto brand-scrollbar"
      >
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
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> From goals / schedule
                </Button>
                <Button size="sm" variant="ghost" onClick={addTarget}>
                  Type one in
                </Button>
              </div>
            </div>
            {/* Inline, inside the Races section — the draft stays put. */}
            <AddRacesPanel
              open={pickerOpen}
              onClose={() => setPickerOpen(false)}
              athleteId={athleteId}
              existing={targets}
              onAdd={(added) =>
                setTargets((t) => [...t, ...added].sort((a, b) => a.raceDate.localeCompare(b.raceDate)))
              }
            />

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
            <NumField label="Peak taper (days)" value={taperDays} onChange={setTaperDays} min={3} max={35} />
            <NumField label="Key taper (days)" value={keyTaperDays} onChange={setKeyTaperDays} min={2} max={21} />
            <NumField label="Race wk −%" value={raceWeekReduction} onChange={setRaceWeekReduction} min={0} max={50} />
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <div className="text-xs font-medium">How this athlete tapers</div>
            <div>
              <Label className="text-[11px]">Strategy</Label>
              <Select value={taperStrategy} onValueChange={(v) => applyTaperStrategy(v as any)}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="traditional">Traditional — long, stepped down</SelectItem>
                  <SelectItem value="high_response">High-response — short, load held then dropped</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Traditional runs 14–21 days, stepping volume down and letting tone relax. High-response runs 7–10
                days, holding volume later then dropping it sharply, with tone kept up. Picking one sets the numbers
                below — change any of them and it becomes Custom.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              {/* Two independent dimensions, because they combine: two days
                  off with barely shorter sessions and one day off with a big
                  session cut reach a similar depth by different routes, and
                  the route is what differs between athletes. */}
              <div>
                <Label className="text-[11px]">Extra rest days</Label>
                <Select
                  value={String(taperRestDays)}
                  onValueChange={(v) => { setTaperRestDays(Number(v)); setTaperStrategy("custom"); }}
                >
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">None — same training days</SelectItem>
                    <SelectItem value="1">One extra day off</SelectItem>
                    <SelectItem value="2">Two extra days off</SelectItem>
                    <SelectItem value="3">Three extra days off</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px]">Session length</Label>
                <Select
                  value={taperSessionCut}
                  onValueChange={(v) => { setTaperSessionCut(v as any); setTaperStrategy("custom"); }}
                >
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minimal">Barely shorter</SelectItem>
                    <SelectItem value="moderate">Noticeably shorter</SelectItem>
                    <SelectItem value="large">Substantially shorter</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-end gap-2 text-[11px] pb-2">
                <input
                  type="checkbox"
                  checked={taperNeuro}
                  onChange={(e) => { setTaperNeuro(e.target.checked); setTaperStrategy("custom"); }}
                />
                Hold tone with frequent short speed inputs
              </label>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              These two are about what fills the week, not how much of it there is — a percentage can't tell a
              five-day week from a seven-day one. They're carried through as guidance for whoever builds the
              sessions.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-[11px]">Race week load</Label>
                {/* Shown as a RESULT by default. The structure below is the
                    decision — a coach who knows the athlete needs two days off
                    doesn't want to be told to add a third to hit a number. */}
                {floorOverride ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={20}
                      max={95}
                      value={taperFloorPct}
                      onChange={(e) => {
                        setTaperFloorPct(Math.max(20, Math.min(95, Number(e.target.value) || 55)));
                        setTaperStrategy("custom");
                      }}
                      className="h-8 w-20"
                    />
                    <span className="text-[11px] text-muted-foreground">% of a normal week</span>
                  </div>
                ) : (
                  <div className="h-8 flex items-center gap-2">
                    <span className="text-lg font-bold tabular-nums">{derivedFloor}%</span>
                    <span className="text-[11px] text-muted-foreground">of a normal week</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (!floorOverride) setTaperFloorPct(derivedFloor);
                    setFloorOverride((v) => !v);
                    setTaperStrategy("custom");
                  }}
                  className="text-[11px] text-muted-foreground hover:text-foreground underline mt-0.5"
                >
                  {floorOverride ? "Back to following the week structure" : "Set this number myself"}
                </button>
              </div>
              <div>
                <Label className="text-[11px]">Shape</Label>
                <Select value={taperShape} onValueChange={(v) => {
                  setTaperShape(v as any);
                  setTaperStrategy("custom");
                }}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="linear">Even — steps down steadily</SelectItem>
                    <SelectItem value="gentle">Gentle — holds load, drops late</SelectItem>
                    <SelectItem value="steep">Steep — sheds early, coasts in</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              An athlete who sharpens on a deep taper wants a low race-week figure; one who loses fitness across two
              light weeks wants it held higher. Shape decides whether the drop comes early or late.{" "}
              <span className="text-foreground">
                Volume only — keeping intensity up through a taper is a matter of which sessions fill the week, not of
                this number.
              </span>
            </p>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <div className="text-xs font-medium">Overload blocks</div>
            <div className="grid sm:grid-cols-3 gap-3">
              <NumField label="Weeks before race" value={overloadBefore} onChange={setOverloadBefore} min={1} max={8} />
              <NumField label="Block length (wk)" value={overloadLen} onChange={setOverloadLen} min={0} max={3} />
              <label className="flex items-end gap-2 text-[11px] pb-2">
                <input type="checkbox" checked={overloadKey} onChange={(e) => setOverloadKey(e.target.checked)} />
                Also before key races
              </label>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              The hardest training of the block, placed far enough out that the work is absorbed before the taper
              starts. Sitting it against the taper asks the taper to shed that fatigue and sharpen at the same time.
              Set the length to 0 to switch overload blocks off.
            </p>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <div className="text-xs font-medium">How this athlete builds</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-[11px]">Base load</Label>
                <Select value={baseProgression} onValueChange={(v) => setBaseProgression(v as any)}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="progressive">Climbs across the block</SelectItem>
                    <SelectItem value="flat">Flat — deloads do the varying</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px]">Build load</Label>
                <Select value={buildProgression} onValueChange={(v) => setBuildProgression(v as any)}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="progressive">Climbs across the block</SelectItem>
                    <SelectItem value="flat">Flat — deloads do the varying</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px]">Quality in base</Label>
                <Select value={String(baseQuality)} onValueChange={(v) => setBaseQuality(Number(v))}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">None — pure aerobic</SelectItem>
                    {/* Stored per-week, shown as an interval, because an
                        interval is how the decision is actually made. The
                        generator spreads anything under 1 across the weeks,
                        so these mark the weeks that really carry the work. */}
                    <SelectItem value="0.25">Once a month</SelectItem>
                    <SelectItem value="0.33">Every third week</SelectItem>
                    <SelectItem value="0.5">Every second week</SelectItem>
                    <SelectItem value="1">One a week</SelectItem>
                    <SelectItem value="2">Two a week</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px]">Quality in build</Label>
                <Select value={String(buildQuality)} onValueChange={(v) => setBuildQuality(Number(v))}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.5">Every second week</SelectItem>
                    <SelectItem value="1">One a week</SelectItem>
                    <SelectItem value="2">Two a week</SelectItem>
                    <SelectItem value="3">Three a week</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Quality density shows on the timeline as vertical stripes — denser means more. It records HOW OFTEN hard
              work appears, not what it is; the session itself comes from whatever template fills the week.
            </p>
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
