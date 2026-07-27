/**
 * Volume Target — aggregate weekly-volume progression ("90km → 100km"),
 * distributed across buckets by a coach-chosen strategy rather than a
 * flat % applied everywhere. Sits above the existing %-based quick-nudge
 * knobs (calendar-copy.ts's ProgressionRules), which stay as-is for their
 * original minor-tweak use case.
 *
 * Deliberately produces output in the same two units the existing engine
 * already understands — a volumePct per bucket (continuous buckets:
 * easy/long/tempo) and a rep-count delta per bucket (interval buckets:
 * threshold/vo2) — so nothing about scaleStep(), buildCopyDraft(), or
 * resolveTemplateDrafts() needs to change. This module only decides HOW
 * MUCH each bucket should move; applying that is the existing pipeline's
 * job, unchanged.
 */

import { COPY_BUCKETS, type CopyBucket, type ProgressionRules } from "./calendar-copy";

export type DistributionStrategy = "long_priority" | "easy_priority" | "proportional";

// Continuous buckets progress by km/time (a coach thinks "+2km"). Interval
// buckets (threshold/vo2) progress by rep count (a coach thinks "+1 rep"),
// not a bigger single effort — so their share of the delta gets converted
// into a rounded rep count instead of a raw distance.
const REP_BUCKETS: CopyBucket[] = ["threshold", "vo2"];

// race is deliberately excluded everywhere below — a race distance is
// prescribed, not something a general volume target should redistribute
// into.
const ELIGIBLE_BUCKETS: CopyBucket[] = COPY_BUCKETS.filter((b) => b !== "race");

export type BucketKm = Partial<Record<CopyBucket, number>>;

export type VolumeTargetResult = {
  kmDeltaByBucket: Partial<Record<CopyBucket, number>>; // easy/long/tempo
  repDeltaByBucket: Partial<Record<CopyBucket, number>>; // threshold/vo2, already rounded
  longRunCapped: boolean; // surfaced so the UI can note "capped, rest redirected"
};

export function computeVolumeTargetDeltas({
  currentKmByBucket,
  targetKm,
  strategy,
  longRunCapKm,
  kmPerRepByBucket,
}: {
  currentKmByBucket: BucketKm;
  targetKm: number;
  strategy: DistributionStrategy;
  longRunCapKm?: number | null;
  kmPerRepByBucket: BucketKm;
}): VolumeTargetResult {
  const scalableBuckets = ELIGIBLE_BUCKETS.filter((b) => (currentKmByBucket[b] ?? 0) > 0);
  const currentTotal = scalableBuckets.reduce((sum, b) => sum + (currentKmByBucket[b] ?? 0), 0);
  const deltaKm = targetKm - currentTotal;

  const kmDeltaByBucket: Partial<Record<CopyBucket, number>> = {};
  let longRunCapped = false;

  if (scalableBuckets.length === 0 || !deltaKm) {
    return { kmDeltaByBucket, repDeltaByBucket: {}, longRunCapped: false };
  }

  function distributeProportionally(buckets: CopyBucket[], amountKm: number) {
    const total = buckets.reduce((sum, b) => sum + (currentKmByBucket[b] ?? 0), 0);
    if (total <= 0) return;
    for (const b of buckets) {
      const share = (currentKmByBucket[b] ?? 0) / total;
      kmDeltaByBucket[b] = (kmDeltaByBucket[b] ?? 0) + amountKm * share;
    }
  }

  // Clips "long"'s allocated delta at the cap (if one's set and long is in
  // play) and redirects whatever didn't fit proportionally across
  // whichever of the other buckets are still eligible.
  function applyLongCapAndRedistribute(otherBuckets: CopyBucket[]) {
    if (longRunCapKm == null || !scalableBuckets.includes("long")) return;
    const currentLong = currentKmByBucket.long ?? 0;
    const allocatedLong = kmDeltaByBucket.long ?? 0;
    const projected = currentLong + allocatedLong;
    if (projected > longRunCapKm) {
      longRunCapped = true;
      const clipped = Math.max(0, longRunCapKm - currentLong);
      const overflow = allocatedLong - clipped;
      kmDeltaByBucket.long = clipped;
      distributeProportionally(
        otherBuckets.filter((b) => b !== "long"),
        overflow,
      );
    }
  }

  if (strategy === "proportional") {
    distributeProportionally(scalableBuckets, deltaKm);
    applyLongCapAndRedistribute(scalableBuckets);
  } else {
    const primary: CopyBucket = strategy === "long_priority" ? "long" : "easy";

    if (!scalableBuckets.includes(primary)) {
      // Chosen priority bucket has no sessions in range at all — fall
      // back to proportional across whatever IS present rather than
      // silently dropping the whole target.
      distributeProportionally(scalableBuckets, deltaKm);
      applyLongCapAndRedistribute(scalableBuckets);
    } else {
      const primaryShare = 0.45; // "split more evenly" — roughly 40-50% to the priority bucket
      const primaryDelta = deltaKm * primaryShare;
      const restDelta = deltaKm - primaryDelta;
      kmDeltaByBucket[primary] = primaryDelta;
      const rest = scalableBuckets.filter((b) => b !== primary);

      if (primary === "long" && longRunCapKm != null) {
        const currentLong = currentKmByBucket.long ?? 0;
        const projected = currentLong + primaryDelta;
        if (projected > longRunCapKm) {
          longRunCapped = true;
          const clipped = Math.max(0, longRunCapKm - currentLong);
          const overflow = primaryDelta - clipped;
          kmDeltaByBucket.long = clipped;
          distributeProportionally(rest, restDelta + overflow);
        } else {
          distributeProportionally(rest, restDelta);
        }
      } else {
        distributeProportionally(rest, restDelta);
        applyLongCapAndRedistribute(scalableBuckets); // long may still be in "rest" under easy_priority
      }
    }
  }

  const repDeltaByBucket: Partial<Record<CopyBucket, number>> = {};
  for (const b of REP_BUCKETS) {
    const kmDelta = kmDeltaByBucket[b];
    if (kmDelta == null) continue;
    const kmPerRep = kmPerRepByBucket[b];
    if (!kmPerRep || kmPerRep <= 0) continue;
    repDeltaByBucket[b] = Math.round(kmDelta / kmPerRep);
    delete kmDeltaByBucket[b]; // reps replace the raw km delta for these buckets
  }

  return { kmDeltaByBucket, repDeltaByBucket, longRunCapped };
}

/**
 * Converts a bucket's km delta into an equivalent volumePct against its
 * current km — the same unit ProgressionRules/scaleStep() already
 * understands, merged onto whatever base rules (e.g. quick-nudge %) are
 * already set rather than replacing them outright.
 */
export function kmDeltasToProgressionRules(
  kmDeltaByBucket: Partial<Record<CopyBucket, number>>,
  currentKmByBucket: BucketKm,
  baseRules: ProgressionRules,
): ProgressionRules {
  const next: ProgressionRules = { ...baseRules };
  for (const bucket of Object.keys(kmDeltaByBucket) as CopyBucket[]) {
    const deltaKm = kmDeltaByBucket[bucket];
    if (deltaKm == null) continue;
    const currentKm = currentKmByBucket[bucket] ?? 0;
    if (currentKm <= 0) continue;
    const pct = Math.round((deltaKm / currentKm) * 1000) / 10;
    next[bucket] = { ...(next[bucket] ?? { volumePct: 0, intensityPct: 0 }), volumePct: pct };
  }
  return next;
}

export { REP_BUCKETS, ELIGIBLE_BUCKETS };
