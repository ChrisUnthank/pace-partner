/**
 * Filling a campaign block from a plan template.
 *
 * The campaign layer produces weeks carrying a phase, a relative load and a
 * deload flag, and no sessions. Plan templates produce sessions and no season
 * structure. This module is the mapping between them, and it is deliberately
 * pure: no Supabase, no React, no dates read from the clock. Everything here
 * is fuzzed in campaign-fill.test.ts.
 *
 *
 * THE BRIDGE
 *
 * campaign_weeks.load_pct means "100 = the athlete's normal loading week".
 * calendar-copy.ts's WeekOverride.volumePct means "+X% off the template's
 * authored volume", fed through scaleStep() — the same engine Copy Period
 * Forward uses. So the whole load bridge is:
 *
 *     volumePct = load_pct - 100
 *
 * That also handles deloads for free. A campaign deload week already carries
 * load_pct 70, so applying load_pct IS applying the deload. Passing a separate
 * DeloadConfig as well would cut an already-cut week twice.
 *
 *
 * WHY THERE IS NO START-DATE RECONCILIATION
 *
 * plan_templates carries only duration_weeks — a template has no start date at
 * all. The start date lives on athlete_plans and is chosen at assign time. So
 * the block's first Monday simply IS the start date; there is nothing to
 * reconcile. Duration is the only real friction, and it is handled below.
 *
 *
 * DURATION MISMATCH
 *
 * A template's weeks cannot be stretched — weeks are discrete. So the mapping
 * is expressed as two independent choices, which compose to cover every case
 * rather than enumerating four modes that overlap:
 *
 *   alignment  head -> template week 1 lands on the block's first week
 *              tail -> the template's LAST week lands on the block's last week
 *
 *   shortfall  repeat      -> cycle back through the template for weeks the
 *                             template does not reach
 *              leave_empty -> leave those weeks unfilled and say so
 *
 * Truncation falls out of alignment with no extra mode: a 12-week template on
 * a 6-week block drops its tail under `head` and its head under `tail`.
 *
 * DEFAULTS, and why (see defaultAlignmentForPhase / DEFAULT_SHORTFALL):
 *
 *   shortfall defaults to `repeat`. A coach who picks a 4-week template for a
 *   6-week base block has chosen a microcycle. Leaving two weeks empty puts a
 *   hole in the middle of a season the campaign says is loaded, and the
 *   campaign's whole promise is that the structure is complete. The repeat is
 *   not a literal duplicate either, because load comes from the campaign week:
 *   week 5 repeats week 1's session SHAPE at week 5's LOAD, which is what a
 *   microcycle is.
 *
 *   alignment defaults to `head`, EXCEPT on taper and race_week blocks where
 *   it defaults to `tail`. A taper template's meaning is in its final week;
 *   head-aligning a 3-week taper onto a 2-week block would hand the athlete
 *   the taper's opening weeks and never reach the sharp end. This is surfaced
 *   in the returned notes and is a visible, flippable choice in the UI — a
 *   presented default, not a silent heuristic.
 */

import { scaleStep, type WeekOverride, type DraftStep } from "./calendar-copy";
import type { Phase } from "./campaign-generator";

// ---------------------------------------------------------------------------
// UTC date helpers.
//
// These are calendar dates with no time component. Local time offers nothing
// here and two ways to get it wrong: toISOString() on a local midnight returns
// the previous day in any UTC+ zone, and a seven-day span crossing a DST change
// is an hour short of seven days. Both bit the campaign generator (Update 46);
// this module never touches local time.
// ---------------------------------------------------------------------------
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  // Rejects "2026-02-31", which Date.parse tolerates by rolling over.
  return new Date(t).toISOString().slice(0, 10) === v;
}

function addDaysUtc(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

function daysBetweenUtc(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FillAlignment = "head" | "tail";
export type FillShortfall = "repeat" | "leave_empty";
export type CollisionPolicy = "proceed" | "skip";

export const DEFAULT_SHORTFALL: FillShortfall = "repeat";

/** See the module header for why taper and race_week differ. */
export function defaultAlignmentForPhase(phase: Phase | null | undefined): FillAlignment {
  return phase === "taper" || phase === "race_week" ? "tail" : "head";
}

/** One campaign week being filled. A subset of campaign_weeks' columns. */
export interface FillTargetWeek {
  /** campaign_weeks.id — absent only on a preview of unsaved weeks. */
  id?: string;
  weekNumber: number;
  /** Monday, yyyy-mm-dd. */
  weekStart: string;
  loadPct: number;
  isDeload: boolean;
  phase: Phase;
  isLocked: boolean;
}

export interface BuildFillPlanInput {
  /** The block's weeks, any order — sorted internally by weekNumber. */
  weeks: FillTargetWeek[];
  templateDurationWeeks: number;
  alignment: FillAlignment;
  shortfall: FillShortfall;
  /**
   * When true (the recommended default), each week's volume comes from the
   * campaign and the template's own progression is overridden. The campaign
   * layer exists to BE the load structure; a template's built-in ramp fighting
   * a campaign's overload-then-deload shape is two authorities on one number.
   *
   * When false the template's authored volume is used as-is and the campaign
   * is treated as shape-only — for a coach who has tuned a template carefully
   * and wants it left alone.
   */
  applyCampaignLoad: boolean;
}

export interface FillSlot {
  campaignWeekId?: string;
  campaignWeekNumber: number;
  weekStart: string;
  phase: Phase;
  isDeload: boolean;
  isLocked: boolean;
  /** Which template week lands here. Null means deliberately left unfilled. */
  templateWeekNumber: number | null;
  /** The campaign's stored load for this week, carried through untouched. */
  loadPct: number;
  /** What actually gets applied: loadPct - 100, or 0 when applyCampaignLoad is off. */
  volumePct: number;
  /** This template week was already used earlier in the same fill. */
  isRepeat: boolean;
}

export interface FillPlan {
  slots: FillSlot[];
  /** The Monday handed to previewPlanAssignment. Empty when there are no weeks. */
  startDate: string;
  /** Template weeks that reach at least one campaign week, ascending. */
  templateWeeksUsed: number[];
  /** Template weeks that reach none — dropped by truncation. */
  templateWeeksDropped: number[];
  /**
   * One per filled slot, consumable directly by assignPlanToAthlete. Keyed by
   * CAMPAIGN week number, which is what the remapped drafts carry.
   */
  weekOverrides: WeekOverride[];
  /** Things the coach should be told before committing. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// buildFillPlan — the mapping itself
// ---------------------------------------------------------------------------

/**
 * Works out which template week lands on which campaign week, and at what
 * load. Pure; does not read the template's sessions at all, only its length.
 */
export function buildFillPlan(input: BuildFillPlanInput): FillPlan {
  const notes: string[] = [];

  const weeks = [...(input.weeks ?? [])]
    .filter((w) => w && Number.isFinite(w.weekNumber) && isIsoDate(w.weekStart))
    .sort((a, b) => a.weekNumber - b.weekNumber);

  // Guarded rather than trusted. A NaN reaching an array length is a
  // RangeError mid-render, which is how the generator took the campaign page
  // down; a zero or negative duration silently produces a modulo by zero.
  const rawDuration = Number(input.templateDurationWeeks);
  const duration = Number.isFinite(rawDuration) ? Math.max(0, Math.floor(rawDuration)) : 0;

  if (weeks.length === 0 || duration === 0) {
    return {
      slots: [],
      startDate: weeks[0]?.weekStart ?? "",
      templateWeeksUsed: [],
      templateWeeksDropped: [],
      weekOverrides: [],
      notes:
        duration === 0
          ? ["This template has no weeks defined, so there is nothing to fill from."]
          : ["This block has no weeks to fill."],
    };
  }

  const alignment: FillAlignment = input.alignment === "tail" ? "tail" : "head";
  const shortfall: FillShortfall = input.shortfall === "leave_empty" ? "leave_empty" : "repeat";
  const n = weeks.length;

  // Offset of the FIRST block week into the template, in template weeks.
  // head: template week 1 sits on block week 1, so offset 0.
  // tail: the template's last week sits on the block's last week, so the
  //       first block week sits duration - n weeks in (negative when the
  //       template is shorter than the block, i.e. it starts before week 1
  //       and the opening slots fall short).
  const offset = alignment === "tail" ? duration - n : 0;

  const usedCounts = new Map<number, number>();
  const slots: FillSlot[] = [];

  for (let i = 0; i < n; i++) {
    const w = weeks[i];
    const rawIndex = offset + i; // 0-based template week index this slot wants

    let templateWeekNumber: number | null;
    if (rawIndex >= 0 && rawIndex < duration) {
      templateWeekNumber = rawIndex + 1;
    } else if (shortfall === "repeat") {
      // Modulo that stays correct for negative indices, which tail alignment
      // produces whenever the template is shorter than the block. JavaScript's
      // % keeps the sign of the dividend, so -1 % 4 is -1, not 3.
      templateWeekNumber = (((rawIndex % duration) + duration) % duration) + 1;
    } else {
      templateWeekNumber = null;
    }

    const seen = templateWeekNumber == null ? 0 : (usedCounts.get(templateWeekNumber) ?? 0);
    if (templateWeekNumber != null) usedCounts.set(templateWeekNumber, seen + 1);

    const loadPct = Number.isFinite(Number(w.loadPct)) ? Number(w.loadPct) : 100;

    slots.push({
      campaignWeekId: w.id,
      campaignWeekNumber: w.weekNumber,
      weekStart: w.weekStart,
      phase: w.phase,
      isDeload: !!w.isDeload,
      isLocked: !!w.isLocked,
      templateWeekNumber,
      loadPct,
      volumePct: input.applyCampaignLoad ? loadPct - 100 : 0,
      isRepeat: seen > 0,
    });
  }

  const used = [...usedCounts.keys()].sort((a, b) => a - b);
  const dropped: number[] = [];
  for (let t = 1; t <= duration; t++) if (!usedCounts.has(t)) dropped.push(t);

  const emptyCount = slots.filter((s) => s.templateWeekNumber == null).length;
  const repeatCount = slots.filter((s) => s.isRepeat).length;

  if (dropped.length > 0) {
    notes.push(
      `The template is ${duration} weeks and this block is ${n}. ` +
        `${dropped.length} template week${dropped.length === 1 ? "" : "s"} ` +
        `(${dropped.join(", ")}) ${dropped.length === 1 ? "does" : "do"} not fit and will be dropped — ` +
        (alignment === "tail" ? "the opening weeks, since this is tail-aligned." : "the tail, since this is head-aligned."),
    );
  }
  if (emptyCount > 0) {
    notes.push(
      `${emptyCount} week${emptyCount === 1 ? "" : "s"} of this block will be left empty — the template is shorter than the block and repeating is turned off.`,
    );
  }
  if (repeatCount > 0) {
    notes.push(
      `The template is shorter than the block, so ${repeatCount} week${repeatCount === 1 ? "" : "s"} repeat${repeatCount === 1 ? "s" : ""} an earlier template week. ` +
        (input.applyCampaignLoad
          ? "Each repeat runs at its own campaign week's load, so it is the same session shape at a different volume, not a duplicate."
          : "Campaign load is turned off, so a repeated week is an exact duplicate of the earlier one, including its volume."),
    );
  }
  if (!input.applyCampaignLoad) {
    notes.push(
      "Campaign load is turned off: the template's own authored volume is used and the campaign's weekly loads are ignored. The timeline will still show the campaign's figures, which the sessions will not match.",
    );
  }

  const lockedFilled = slots.filter((s) => s.isLocked && s.templateWeekNumber != null);
  if (lockedFilled.length > 0) {
    notes.push(
      `${lockedFilled.length} of these weeks ${lockedFilled.length === 1 ? "has" : "have"} a hand-edited load, which is being used as-is rather than the generator's original figure.`,
    );
  }

  return {
    slots,
    startDate: slots[0].weekStart,
    templateWeeksUsed: used,
    templateWeeksDropped: dropped,
    weekOverrides: slots
      .filter((s) => s.templateWeekNumber != null)
      .map((s) => ({
        id: `campaign-week-${s.campaignWeekNumber}`,
        fromWeek: s.campaignWeekNumber,
        toWeek: s.campaignWeekNumber,
        volumePct: s.volumePct,
      })),
    notes,
  };
}

// ---------------------------------------------------------------------------
// applyFillPlan — remapping the previewed drafts onto the plan
// ---------------------------------------------------------------------------

/**
 * Minimal shape this module needs from plan.functions.ts's PlanAssignDraft.
 * Declared structurally rather than imported so this file stays free of the
 * server-function module (and its Supabase middleware import), which would
 * otherwise be pulled into the test run.
 */
export interface RemappableDraft {
  tempId: string;
  sourceSessionId: string;
  athlete_id: string;
  week_number: number;
  session_date: string;
  title: string;
  day_type: string;
  intent: string | null;
  structure: string | null;
  is_long_run: boolean;
  bucket: any;
  needsReview: boolean;
  steps: DraftStep[];
  session_template_id: string | null;
}

/**
 * Takes the RAW drafts from previewPlanAssignment (called with the block's
 * first Monday and NO progression rules) and re-dates, re-numbers and rescales
 * them onto the fill plan's slots.
 *
 * Preview is deliberately called without overrides. Overrides are keyed by
 * TEMPLATE week, and a repeat maps one template week onto several campaign
 * weeks at different loads — which a template-week-keyed override cannot
 * express. So the raw template comes back unscaled and the scaling happens
 * here, once, per slot.
 *
 * Day-of-week is recovered by date arithmetic against the preview start rather
 * than by parsing tempId. tempId happens to be `${week}-${day}` today, but that
 * is an internal convention of resolveTemplateDrafts, whereas the date offset
 * is guaranteed by the contract that a template day lands on
 * startDate + (week-1)*7 + (day-1).
 */
export function applyFillPlan(
  drafts: RemappableDraft[],
  plan: FillPlan,
  previewStartDate: string,
): { drafts: RemappableDraft[]; flaggedCount: number } {
  if (!isIsoDate(previewStartDate) || plan.slots.length === 0) {
    return { drafts: [], flaggedCount: 0 };
  }

  // Template week -> its days, each with the day offset (0..6) within the week.
  const byTemplateWeek = new Map<number, { dayOffset: number; draft: RemappableDraft }[]>();
  for (const d of drafts ?? []) {
    if (!d || !isIsoDate(d.session_date)) continue;
    const wk = Number(d.week_number);
    if (!Number.isFinite(wk) || wk < 1) continue;
    const dayOffset = daysBetweenUtc(previewStartDate, d.session_date) - (wk - 1) * 7;
    // A day offset outside 0-6 means the draft's week_number and its date
    // disagree. Dropping it silently would lose a session; better to keep it
    // at its own week and let the offset clamp, so nothing vanishes.
    const clamped = Math.max(0, Math.min(6, dayOffset));
    const list = byTemplateWeek.get(wk) ?? [];
    list.push({ dayOffset: clamped, draft: d });
    byTemplateWeek.set(wk, list);
  }

  const out: RemappableDraft[] = [];
  let flaggedCount = 0;

  for (const slot of plan.slots) {
    if (slot.templateWeekNumber == null) continue;
    const source = byTemplateWeek.get(slot.templateWeekNumber);
    if (!source || source.length === 0) continue;

    const rule = slot.volumePct === 0 ? undefined : { volumePct: slot.volumePct, intensityPct: 0 };

    for (const { dayOffset, draft } of source) {
      let needsReview = draft.needsReview;
      const steps = (draft.steps ?? []).map((s: any) => {
        // A bucket-less day (cross_train, rest, strides) has nothing to scale
        // — same convention Copy Period Forward and the plan progression
        // builder already use, so an unscalable day copies across untouched
        // rather than being silently left out of the load calculation.
        const { step, flagged } = scaleStep(s, draft.bucket ? rule : undefined);
        if (flagged) needsReview = true;
        return step;
      });
      if (needsReview && !draft.needsReview) flaggedCount++;

      out.push({
        ...draft,
        // Unique per SLOT, not per template day — a repeated template week
        // would otherwise produce two drafts with the same tempId, and the
        // review UI keys its edit map on it.
        tempId: `cw${slot.campaignWeekNumber}-${slot.templateWeekNumber}-${dayOffset}`,
        sourceSessionId: draft.sourceSessionId,
        week_number: slot.campaignWeekNumber,
        session_date: addDaysUtc(slot.weekStart, dayOffset),
        needsReview,
        steps,
      });
    }
  }

  out.sort((a, b) => (a.session_date < b.session_date ? -1 : a.session_date > b.session_date ? 1 : 0));
  return { drafts: out, flaggedCount };
}

// ---------------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------------

export interface FillCollision {
  date: string;
  /** Titles of the sessions already sitting on that date. */
  existingTitles: string[];
  /** Titles this fill wants to add there. */
  incomingTitles: string[];
}

/**
 * Days where the fill would land on top of sessions that already exist.
 *
 * `is_locked` on a campaign week says a human edited its LOAD. It says nothing
 * about whether sessions exist on those dates, so it cannot be used for this —
 * a week can be untouched and still have a manually-logged run in it.
 */
export function detectFillCollisions(
  drafts: RemappableDraft[],
  existingByDate: Map<string, string[]>,
): FillCollision[] {
  const incomingByDate = new Map<string, string[]>();
  for (const d of drafts ?? []) {
    if (!d || !isIsoDate(d.session_date)) continue;
    const list = incomingByDate.get(d.session_date) ?? [];
    list.push(d.title);
    incomingByDate.set(d.session_date, list);
  }

  const collisions: FillCollision[] = [];
  for (const [date, incomingTitles] of incomingByDate) {
    const existingTitles = existingByDate.get(date);
    if (existingTitles && existingTitles.length > 0) {
      collisions.push({ date, existingTitles: [...existingTitles], incomingTitles });
    }
  }
  collisions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return collisions;
}

/**
 * Applies the coach's answer to the collision warning.
 *
 * `proceed` keeps everything — the existing session and the new one both stand,
 * which is legitimate (a double day, or a gym session alongside a run).
 * `skip` drops only the colliding days, not the whole week: the rest of the
 * week still fills, because a Tuesday clash is no reason to lose Thursday.
 */
export function applyCollisionPolicy(
  drafts: RemappableDraft[],
  collisions: FillCollision[],
  policy: CollisionPolicy,
): RemappableDraft[] {
  if (policy === "proceed") return drafts;
  const blocked = new Set(collisions.map((c) => c.date));
  return (drafts ?? []).filter((d) => !blocked.has(d.session_date));
}

// ---------------------------------------------------------------------------
// Write-back to the campaign
// ---------------------------------------------------------------------------

export interface CampaignWeekWriteBack {
  campaignWeekId: string;
  campaignWeekNumber: number;
  weekStart: string;
  fromLoadPct: number;
  toLoadPct: number;
}

/**
 * Weeks whose load the coach changed during the fill review, so the campaign
 * can be brought back into agreement with what was actually prescribed.
 *
 * WHY THIS EXISTS AT ALL. The recommended flow is campaign first, then plans
 * falling in line beneath it. If a coach overrides a week's load while filling
 * and the campaign is not updated, the campaign timeline now states a figure
 * the sessions underneath it do not match — and the actual-vs-planned overlay
 * reads that gap as an athlete missing training rather than as a stale plan.
 * A campaign that disagrees with its own sessions is worse than an incomplete
 * one: it is confidently wrong.
 *
 * WHY IT IS NEVER SILENT. This returns the diff for the UI to show and confirm.
 * A plan dialog quietly rewriting the season structure is exactly the class of
 * hidden write the campaign RLS split was closing off.
 *
 * Free side effect worth knowing: campaign_weeks has a BEFORE UPDATE trigger
 * (campaign_week_lock_on_edit) that sets is_locked whenever load_pct changes.
 * So an accepted write-back automatically protects those weeks from being
 * undone by a later regeneration, with no extra bookkeeping.
 */
export function computeCampaignWriteBacks(
  slots: FillSlot[],
  overriddenLoadByWeekNumber: Map<number, number>,
): CampaignWeekWriteBack[] {
  const out: CampaignWeekWriteBack[] = [];
  for (const slot of slots) {
    if (!slot.campaignWeekId) continue;
    if (slot.templateWeekNumber == null) continue;
    const next = overriddenLoadByWeekNumber.get(slot.campaignWeekNumber);
    if (next == null || !Number.isFinite(next)) continue;
    if (Math.abs(next - slot.loadPct) < 0.005) continue;
    out.push({
      campaignWeekId: slot.campaignWeekId,
      campaignWeekNumber: slot.campaignWeekNumber,
      weekStart: slot.weekStart,
      fromLoadPct: slot.loadPct,
      toLoadPct: next,
    });
  }
  return out;
}

/** Row shape for campaign_week_fills, one per filled slot. */
export function buildFillRows(
  slots: FillSlot[],
  athletePlanId: string,
  planTemplateId: string | null,
  templateName: string | null,
): {
  campaign_week_id: string;
  athlete_plan_id: string;
  plan_template_id: string | null;
  template_name: string | null;
  template_week_number: number;
  is_repeat: boolean;
  load_pct_applied: number;
}[] {
  return slots
    .filter((s) => s.templateWeekNumber != null && !!s.campaignWeekId)
    .map((s) => ({
      campaign_week_id: s.campaignWeekId!,
      athlete_plan_id: athletePlanId,
      plan_template_id: planTemplateId,
      template_name: templateName,
      template_week_number: s.templateWeekNumber!,
      is_repeat: s.isRepeat,
      // What was ACTUALLY applied. With campaign load off the template's own
      // volume stands, which is 100% of itself — not the campaign's figure,
      // which was ignored.
      load_pct_applied: s.volumePct === 0 && s.loadPct !== 100 ? 100 : s.loadPct,
    }));
}
