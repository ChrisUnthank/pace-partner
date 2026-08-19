import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deriveTaperFloor } from "@/lib/campaign-generator";

// ----------------------------------------------------------------------------
// One settings panel, used by both the create and the edit dialog.
//
// These controls previously existed only in the create dialog. The edit dialog
// held every piece of STATE for them — taperStrategy, rest days, session cut,
// overload placement, quality density, deload percentage — and rendered four
// of them. So a coach could set a taper archetype when building a campaign and
// then never see it again, and any edit silently wrote defaults back over the
// half that had no control.
//
// The cause was two copies of the same form. Extracting it means a control
// added here appears in both places by construction, which is the only version
// of this fix that stays fixed.
// ----------------------------------------------------------------------------

export type TaperStrategy = "traditional" | "high_response" | "custom";
export type TaperShape = "linear" | "gentle" | "steep";
export type SessionCut = "minimal" | "moderate" | "large";
export type Progression = "progressive" | "flat";

export interface CampaignSettings {
  resetWeeks: number;
  transitionWeeks: number;
  loadWeeks: number;
  deloadWeeks: number;
  deloadsEnabled: boolean;
  deloadPct: number;

  taperDays: number;
  keyTaperDays: number;
  raceWeekReduction: number;
  taperStrategy: TaperStrategy;
  taperRestDays: number;
  taperSessionCut: SessionCut;
  taperNeuro: boolean;
  taperFrequencyMode: "fewer_days" | "same_days_shorter";
  taperFloorPct: number;
  /** True when the coach has taken the race-week figure off the structure. */
  floorOverride: boolean;
  taperShape: TaperShape;

  overloadBefore: number;
  overloadLen: number;
  overloadKey: boolean;

  baseProgression: Progression;
  buildProgression: Progression;
  baseQuality: number;
  buildQuality: number;
}

export function defaultCampaignSettings(): CampaignSettings {
  return {
    resetWeeks: 2,
    transitionWeeks: 2,
    loadWeeks: 3,
    deloadWeeks: 1,
    deloadsEnabled: true,
    deloadPct: 70,
    taperDays: 14,
    keyTaperDays: 7,
    raceWeekReduction: 15,
    taperStrategy: "traditional",
    taperRestDays: 1,
    taperSessionCut: "moderate",
    taperNeuro: false,
    taperFrequencyMode: "fewer_days",
    taperFloorPct: 55,
    floorOverride: false,
    taperShape: "linear",
    overloadBefore: 3,
    overloadLen: 1,
    overloadKey: true,
    baseProgression: "progressive",
    buildProgression: "progressive",
    baseQuality: 0.5,
    buildQuality: 2,
  };
}

function num(v: any, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Reads a saved campaigns row back into settings, defaulting anything absent. */
export function campaignSettingsFromRow(row: any): CampaignSettings {
  const d = defaultCampaignSettings();
  if (!row) return d;
  const restDays = num(row.taper_rest_days_added, d.taperRestDays);
  const sessionCut = (row.taper_session_reduction ?? d.taperSessionCut) as SessionCut;
  const storedFloor = num(row.taper_floor_pct, d.taperFloorPct);
  return {
    resetWeeks: num(row.reset_weeks, d.resetWeeks),
    transitionWeeks: num(row.transition_weeks, d.transitionWeeks),
    loadWeeks: num(row.load_weeks, d.loadWeeks),
    deloadWeeks: num(row.deload_weeks, d.deloadWeeks),
    deloadsEnabled: row.deloads_enabled ?? d.deloadsEnabled,
    deloadPct: num(row.load_deload_pct, d.deloadPct),
    taperDays: num(row.taper_days, d.taperDays),
    keyTaperDays: num(row.key_taper_days, d.keyTaperDays),
    raceWeekReduction: num(row.race_week_reduction_pct, d.raceWeekReduction),
    taperStrategy: (row.taper_strategy ?? d.taperStrategy) as TaperStrategy,
    taperRestDays: restDays,
    taperSessionCut: sessionCut,
    taperNeuro: row.taper_neuromuscular ?? d.taperNeuro,
    taperFrequencyMode: (row.taper_frequency_mode ?? d.taperFrequencyMode) as CampaignSettings["taperFrequencyMode"],
    taperFloorPct: storedFloor,
    // Reconstructed rather than stored: if the saved figure is what the
    // structure implies, the coach was following the structure. Storing a
    // separate "was this overridden" flag would be a second source of truth
    // for one that can be derived exactly.
    floorOverride: Math.abs(storedFloor - deriveTaperFloor(restDays, sessionCut)) > 0.5,
    taperShape: (row.taper_shape ?? d.taperShape) as TaperShape,
    overloadBefore: num(row.overload_weeks_before_race, d.overloadBefore),
    overloadLen: num(row.overload_block_weeks, d.overloadLen),
    overloadKey: row.overload_before_key ?? d.overloadKey,
    baseProgression: (row.base_progression ?? d.baseProgression) as Progression,
    buildProgression: (row.build_progression ?? d.buildProgression) as Progression,
    baseQuality: num(row.base_quality_per_week, d.baseQuality),
    buildQuality: num(row.build_quality_per_week, d.buildQuality),
  };
}

/** The campaigns-table columns these settings map onto. */
export function campaignSettingsToRow(s: CampaignSettings): Record<string, any> {
  return {
    reset_weeks: s.resetWeeks,
    transition_weeks: s.transitionWeeks,
    load_weeks: s.loadWeeks,
    deload_weeks: s.deloadWeeks,
    deloads_enabled: s.deloadsEnabled,
    load_deload_pct: s.deloadPct,
    taper_days: s.taperDays,
    key_taper_days: s.keyTaperDays,
    // Kept in step with the day figures they are rounded from — the generator
    // reads days, but older rows and some queries still read weeks.
    taper_weeks: Math.ceil(s.taperDays / 7),
    key_taper_weeks: Math.ceil(s.keyTaperDays / 7),
    race_week_reduction_pct: s.raceWeekReduction,
    taper_strategy: s.taperStrategy,
    taper_rest_days_added: s.taperRestDays,
    taper_session_reduction: s.taperSessionCut,
    taper_neuromuscular: s.taperNeuro,
    taper_frequency_mode: s.taperFrequencyMode,
    taper_floor_pct: s.taperFloorPct,
    taper_shape: s.taperShape,
    overload_weeks_before_race: s.overloadBefore,
    overload_block_weeks: s.overloadLen,
    overload_before_key: s.overloadKey,
    base_progression: s.baseProgression,
    build_progression: s.buildProgression,
    base_quality_per_week: s.baseQuality,
    build_quality_per_week: s.buildQuality,
  };
}

/**
 * Applying an archetype sets the numbers; changing a number afterwards moves
 * the strategy to "custom".
 *
 * A preset that silently overrode later edits would be worse than no preset —
 * the coach would change the taper length and watch it snap back.
 */
export function applyTaperStrategy(s: CampaignSettings, v: TaperStrategy): CampaignSettings {
  if (v === "traditional") {
    return {
      ...s,
      taperStrategy: v,
      taperDays: 17,
      taperFloorPct: 35,
      taperShape: "linear",
      taperFrequencyMode: "fewer_days",
      taperNeuro: false,
      taperRestDays: 2,
      taperSessionCut: "moderate",
      floorOverride: false,
    };
  }
  if (v === "high_response") {
    return {
      ...s,
      taperStrategy: v,
      taperDays: 9,
      taperFloorPct: 50,
      taperShape: "gentle",
      taperFrequencyMode: "same_days_shorter",
      taperNeuro: true,
      taperRestDays: 0,
      taperSessionCut: "large",
      floorOverride: false,
    };
  }
  return { ...s, taperStrategy: v };
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
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
        className="h-8"
      />
    </div>
  );
}

export function CampaignSettingsFields({
  value,
  onChange,
  baselineKm,
}: {
  value: CampaignSettings;
  onChange: (next: CampaignSettings) => void;
  /** Used only to show the deload percentage as kilometres. */
  baselineKm?: number | null;
}) {
  const s = value;
  const set = (patch: Partial<CampaignSettings>) => onChange({ ...s, ...patch });
  // Any manual change to a taper number takes it off the archetype.
  const setCustom = (patch: Partial<CampaignSettings>) =>
    onChange({ ...s, ...patch, taperStrategy: "custom" });

  const derivedFloor = deriveTaperFloor(s.taperRestDays, s.taperSessionCut);

  return (
    <>
      <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <NumField label="Down weeks" value={s.resetWeeks} onChange={(v) => set({ resetWeeks: v })} min={0} max={8} />
        <NumField
          label="Transition weeks"
          value={s.transitionWeeks}
          onChange={(v) => set({ transitionWeeks: v })}
          min={0}
          max={8}
        />
        <NumField label="Load weeks" value={s.loadWeeks} onChange={(v) => set({ loadWeeks: v })} min={1} max={6} />
        <NumField label="Deload weeks" value={s.deloadWeeks} onChange={(v) => set({ deloadWeeks: v })} min={0} max={2} />
        <NumField label="Peak taper (days)" value={s.taperDays} onChange={(v) => setCustom({ taperDays: v })} min={3} max={35} />
        <NumField label="Key taper (days)" value={s.keyTaperDays} onChange={(v) => setCustom({ keyTaperDays: v })} min={2} max={21} />
        <NumField
          label="Race wk −%"
          value={s.raceWeekReduction}
          onChange={(v) => set({ raceWeekReduction: v })}
          min={0}
          max={50}
        />
      </div>

      <div className="rounded-lg border p-3 space-y-2">
        <div className="text-xs font-medium">How this athlete tapers</div>
        <div>
          <Label className="text-[11px]">Strategy</Label>
          <Select value={s.taperStrategy} onValueChange={(v) => onChange(applyTaperStrategy(s, v as TaperStrategy))}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="traditional">Traditional — long, stepped down</SelectItem>
              <SelectItem value="high_response">High-response — short, load held then dropped</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1">
            Traditional runs 14–21 days, stepping volume down and letting tone relax. High-response runs 7–10 days,
            holding volume later then dropping it sharply, with tone kept up. Picking one sets the numbers below —
            change any of them and it becomes Custom.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {/* Two independent dimensions, because they combine: two days off
              with barely shorter sessions and one day off with a big session
              cut reach a similar depth by different routes, and the route is
              what differs between athletes. */}
          <div>
            <Label className="text-[11px]">Extra rest days</Label>
            <Select value={String(s.taperRestDays)} onValueChange={(v) => setCustom({ taperRestDays: Number(v) })}>
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
              value={s.taperSessionCut}
              onValueChange={(v) => setCustom({ taperSessionCut: v as SessionCut })}
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
              checked={s.taperNeuro}
              onChange={(e) => setCustom({ taperNeuro: e.target.checked })}
            />
            Hold tone with frequent short speed inputs
          </label>
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug">
          These two are about what fills the week, not how much of it there is — a percentage can't tell a five-day
          week from a seven-day one. They're carried through as guidance for whoever builds the sessions.
        </p>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-[11px]">Race week load</Label>
            {/* Shown as a RESULT by default. The structure above is the
                decision — a coach who knows the athlete needs two days off
                doesn't want to be told to add a third to hit a number. */}
            {s.floorOverride ? (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={20}
                  max={95}
                  value={s.taperFloorPct}
                  onChange={(e) =>
                    setCustom({ taperFloorPct: Math.max(20, Math.min(95, Number(e.target.value) || 55)) })
                  }
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
              onClick={() =>
                setCustom({
                  taperFloorPct: s.floorOverride ? s.taperFloorPct : derivedFloor,
                  floorOverride: !s.floorOverride,
                })
              }
              className="text-[11px] text-muted-foreground hover:text-foreground underline mt-0.5"
            >
              {s.floorOverride ? "Back to following the week structure" : "Set this number myself"}
            </button>
          </div>
          <div>
            <Label className="text-[11px]">Shape</Label>
            <Select value={s.taperShape} onValueChange={(v) => setCustom({ taperShape: v as TaperShape })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="linear">Even — steps down steadily</SelectItem>
                <SelectItem value="gentle">Gentle — holds load, drops late</SelectItem>
                <SelectItem value="steep">Steep — sheds early, coasts in</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug">
          An athlete who sharpens on a deep taper wants a low race-week figure; one who loses fitness across two light
          weeks wants it held higher. Shape decides whether the drop comes early or late.{" "}
          <span className="text-foreground">
            Volume only — keeping intensity up through a taper is a matter of which sessions fill the week, not of this
            number.
          </span>
        </p>
      </div>

      <div className="rounded-lg border p-3 space-y-2">
        <div className="text-xs font-medium">Overload blocks</div>
        <div className="grid sm:grid-cols-3 gap-3">
          <NumField
            label="Weeks before race"
            value={s.overloadBefore}
            onChange={(v) => set({ overloadBefore: v })}
            min={1}
            max={8}
          />
          <NumField label="Block length (wk)" value={s.overloadLen} onChange={(v) => set({ overloadLen: v })} min={0} max={3} />
          <label className="flex items-end gap-2 text-[11px] pb-2">
            <input type="checkbox" checked={s.overloadKey} onChange={(e) => set({ overloadKey: e.target.checked })} />
            Also before key races
          </label>
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug">
          The hardest training of the block, placed far enough out that the work is absorbed before the taper starts.
          Sitting it against the taper asks the taper to shed that fatigue and sharpen at the same time. Set the length
          to 0 to switch overload blocks off.
        </p>
      </div>

      <div className="rounded-lg border p-3 space-y-2">
        <div className="text-xs font-medium">How this athlete builds</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-[11px]">Base load</Label>
            <Select value={s.baseProgression} onValueChange={(v) => set({ baseProgression: v as Progression })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="progressive">Climbs across the block</SelectItem>
                <SelectItem value="flat">Flat — deloads do the varying</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Build load</Label>
            <Select value={s.buildProgression} onValueChange={(v) => set({ buildProgression: v as Progression })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="progressive">Climbs across the block</SelectItem>
                <SelectItem value="flat">Flat — deloads do the varying</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Quality in base</Label>
            <Select value={String(s.baseQuality)} onValueChange={(v) => set({ baseQuality: Number(v) })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">None — pure aerobic</SelectItem>
                {/* Stored per-week, shown as an interval, because an interval
                    is how the decision is actually made. The generator spreads
                    anything under 1 across the weeks, so these mark the weeks
                    that really carry the work. */}
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
            <Select value={String(s.buildQuality)} onValueChange={(v) => set({ buildQuality: Number(v) })}>
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
          Quality density shows on the timeline as vertical stripes — denser means more. It records HOW OFTEN hard work
          appears, not what it is; the session itself comes from whatever template fills the week.
        </p>
      </div>

      <div className="rounded-lg border p-3 space-y-2">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={s.deloadsEnabled}
            onChange={(e) => set({ deloadsEnabled: e.target.checked })}
          />
          Deload on a fixed rhythm. Off means loading runs continuously and you add recovery yourself.
        </label>
        {s.deloadsEnabled && (
          <div className="flex items-center gap-2 flex-wrap">
            <Label className="text-[11px]">Deload week load</Label>
            <Input
              type="number"
              min={30}
              max={100}
              value={s.deloadPct}
              onChange={(e) => set({ deloadPct: Math.max(30, Math.min(100, Number(e.target.value) || 70)) })}
              className="h-8 w-20"
            />
            <span className="text-[11px] text-muted-foreground">
              % of a normal week
              {baselineKm ? ` — about ${Math.round((s.deloadPct / 100) * baselineKm)} km` : ""}
            </span>
          </div>
        )}
      </div>
    </>
  );
}
