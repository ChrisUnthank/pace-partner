/**
 * Blood markers a distance runner's panel actually reports.
 *
 * A SUGGESTION LIST, NOT A VALIDATION LIST. `blood_results.marker` is free
 * text on purpose — a CHECK constraint or an enum would reject the first
 * marker a lab reports that nobody anticipated, and losing a real measurement
 * is worse than an untidy name. These entries exist to make the common case
 * fast and to keep spelling and units consistent when they are used.
 *
 * WHAT IS DELIBERATELY ABSENT: target values.
 *
 * Every entry below carries a unit and a category and nothing else. There is
 * no "optimal for endurance athletes" figure anywhere in this file, because
 * those figures are contested clinical opinion rather than fact and they vary
 * by sex, age, altitude, assay and practitioner. The reference range that
 * applies to a measurement is the one the lab printed on that report, which is
 * why it is stored per result rather than looked up from here.
 *
 * Iron is where this matters most. Population ferritin ranges commonly start
 * around 30 ug/L; a good deal of sports-medicine practice treats endurance
 * athletes as wanting considerably more. Encoding either position as the
 * app's answer would be presenting a judgement as a measurement — the same
 * mistake as showing a fabricated score where real data does not exist.
 */

export interface BloodMarkerDef {
  /** Canonical name, stored in blood_results.marker. */
  name: string;
  /** Default unit — still editable, since labs differ. */
  unit: string;
  category: "iron" | "haematology" | "vitamins" | "hormones" | "muscle" | "metabolic" | "other";
  /** What it is, in a sentence a coach can use. No thresholds. */
  note?: string;
}

export const BLOOD_MARKER_CATEGORY_LABEL: Record<BloodMarkerDef["category"], string> = {
  iron: "Iron studies",
  haematology: "Full blood count",
  vitamins: "Vitamins",
  hormones: "Hormones",
  muscle: "Muscle & inflammation",
  metabolic: "Metabolic",
  other: "Other",
};

export const BLOOD_MARKERS: BloodMarkerDef[] = [
  // Iron studies — the panel most often run on a runner who is flat.
  { name: "Ferritin", unit: "µg/L", category: "iron", note: "Stored iron. The marker most often chased when an endurance athlete is unexplainably tired." },
  { name: "Serum iron", unit: "µmol/L", category: "iron", note: "Circulating iron. Moves with recent intake, so a single reading says less than ferritin." },
  { name: "Transferrin", unit: "g/L", category: "iron" },
  { name: "Transferrin saturation", unit: "%", category: "iron", note: "How much of the transport capacity is carrying iron." },
  { name: "TIBC", unit: "µmol/L", category: "iron", note: "Total iron binding capacity." },

  // Full blood count.
  { name: "Haemoglobin", unit: "g/L", category: "haematology", note: "Oxygen-carrying capacity. Can read low in trained endurance athletes through plasma volume expansion rather than any deficiency." },
  { name: "Haematocrit", unit: "%", category: "haematology" },
  { name: "Red cell count", unit: "×10¹²/L", category: "haematology" },
  { name: "MCV", unit: "fL", category: "haematology", note: "Average red cell size." },
  { name: "White cell count", unit: "×10⁹/L", category: "haematology" },
  { name: "Neutrophils", unit: "×10⁹/L", category: "haematology" },
  { name: "Lymphocytes", unit: "×10⁹/L", category: "haematology" },
  { name: "Platelets", unit: "×10⁹/L", category: "haematology" },

  // Vitamins.
  { name: "Vitamin D (25-OH)", unit: "nmol/L", category: "vitamins", note: "Seasonal in most climates — a winter reading and a summer one are not comparable." },
  { name: "Vitamin B12", unit: "pmol/L", category: "vitamins" },
  { name: "Folate", unit: "nmol/L", category: "vitamins" },

  // Hormones.
  { name: "TSH", unit: "mIU/L", category: "hormones", note: "Thyroid. Screened when fatigue has no other explanation." },
  { name: "Free T4", unit: "pmol/L", category: "hormones" },
  { name: "Testosterone", unit: "nmol/L", category: "hormones" },
  { name: "Oestradiol", unit: "pmol/L", category: "hormones" },
  { name: "Cortisol", unit: "nmol/L", category: "hormones", note: "Strongly time-of-day dependent — record when the sample was taken." },
  { name: "IGF-1", unit: "nmol/L", category: "hormones" },

  // Muscle and inflammation.
  { name: "Creatine kinase", unit: "U/L", category: "muscle", note: "Rises with muscle damage, including from ordinary hard training — a reading taken two days after a session is not a baseline." },
  { name: "CRP", unit: "mg/L", category: "muscle", note: "General inflammation." },
  { name: "ESR", unit: "mm/hr", category: "muscle" },

  // Metabolic.
  { name: "Glucose (fasting)", unit: "mmol/L", category: "metabolic" },
  { name: "Sodium", unit: "mmol/L", category: "metabolic" },
  { name: "Potassium", unit: "mmol/L", category: "metabolic" },
  { name: "Magnesium", unit: "mmol/L", category: "metabolic" },
  { name: "Calcium (corrected)", unit: "mmol/L", category: "metabolic" },
  { name: "Urea", unit: "mmol/L", category: "metabolic" },
  { name: "Creatinine", unit: "µmol/L", category: "metabolic" },
  { name: "ALT", unit: "U/L", category: "metabolic" },
  { name: "Albumin", unit: "g/L", category: "metabolic" },
];

export function findMarker(name: string): BloodMarkerDef | undefined {
  const n = name.trim().toLowerCase();
  return BLOOD_MARKERS.find((m) => m.name.toLowerCase() === n);
}

export type RangeFlag = "low" | "high" | "in_range" | "no_range";

/**
 * Where a value sits against the range THE LAB REPORTED for it.
 *
 * Returns "no_range" rather than guessing when the report carried no bounds.
 * Nothing here substitutes a default range: a value shown as in-range against
 * a range nobody supplied would be an invention, and this is exactly the kind
 * of number a coach would act on.
 */
export function flagAgainstRange(
  value: number,
  refLow: number | null | undefined,
  refHigh: number | null | undefined,
): RangeFlag {
  const lo = refLow == null ? null : Number(refLow);
  const hi = refHigh == null ? null : Number(refHigh);
  const hasLo = lo != null && Number.isFinite(lo);
  const hasHi = hi != null && Number.isFinite(hi);
  if (!hasLo && !hasHi) return "no_range";
  if (!Number.isFinite(value)) return "no_range";
  if (hasLo && value < lo!) return "low";
  if (hasHi && value > hi!) return "high";
  return "in_range";
}

export const RANGE_FLAG_LABEL: Record<RangeFlag, string> = {
  low: "Below lab range",
  high: "Above lab range",
  in_range: "Within lab range",
  no_range: "No range given",
};

/**
 * Percentage position within the lab range, for a simple bar.
 * Null when the range is one-sided or absent — half a range cannot be
 * positioned within, and stretching one bound into a fake span would draw a
 * confident picture of something unknown.
 */
export function positionInRange(
  value: number,
  refLow: number | null | undefined,
  refHigh: number | null | undefined,
): number | null {
  // Checked for null BEFORE Number(), because Number(null) is 0 and 0 is
  // finite — so a report with only an upper bound would silently acquire a
  // lower bound of zero and draw a confident bar across a range nobody
  // supplied. Caught by the one-sided test below.
  if (refLow == null || refHigh == null) return null;
  const lo = Number(refLow);
  const hi = Number(refHigh);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, ((value - lo) / (hi - lo)) * 100));
}
