import { useState } from "react";
import { cn } from "@/lib/utils";

export type BodyView = "front" | "back";
export type BodySide = "left" | "right" | "n/a";

// A screen-position convention, not an anatomically mirrored one — the dot
// drawn on the left of the image is "left", consistently for both front
// and back views. Simple and predictable rather than clinically precise,
// which is the right tradeoff for a schematic picker like this.
export interface BodyRegionDot {
  x: number;
  y: number;
  side: BodySide;
}

export interface BodyRegionDef {
  key: string;
  label: string;
  view: BodyView;
  dots: BodyRegionDot[];
}

export interface BodyMapValue {
  region: string;
  side: BodySide;
}

// One shared coordinate set for a simple front-facing schematic figure
// (arms straight down at the sides, the standard convention for these
// "click where it hurts" diagrams) — reused for both the front and back
// view, since the silhouette shape itself is identical; only which
// regions are labeled (and their side) changes.
export const BODY_REGIONS: BodyRegionDef[] = [
  // ---- front ----
  { key: "head", label: "Head", view: "front", dots: [{ x: 100, y: 25, side: "n/a" }] },
  { key: "neck", label: "Neck", view: "front", dots: [{ x: 100, y: 47, side: "n/a" }] },
  { key: "shoulder", label: "Shoulder", view: "front", dots: [{ x: 51, y: 60, side: "left" }, { x: 149, y: 60, side: "right" }] },
  { key: "chest", label: "Chest", view: "front", dots: [{ x: 100, y: 80, side: "n/a" }] },
  { key: "upper_arm", label: "Upper arm", view: "front", dots: [{ x: 51, y: 88, side: "left" }, { x: 149, y: 88, side: "right" }] },
  { key: "elbow", label: "Elbow", view: "front", dots: [{ x: 48, y: 113, side: "left" }, { x: 152, y: 113, side: "right" }] },
  { key: "forearm", label: "Forearm", view: "front", dots: [{ x: 48, y: 140, side: "left" }, { x: 152, y: 140, side: "right" }] },
  { key: "wrist_hand", label: "Wrist / hand", view: "front", dots: [{ x: 48, y: 178, side: "left" }, { x: 152, y: 178, side: "right" }] },
  { key: "abdomen", label: "Abdomen", view: "front", dots: [{ x: 100, y: 118, side: "n/a" }] },
  { key: "hip_flexor", label: "Hip flexor", view: "front", dots: [{ x: 80, y: 150, side: "left" }, { x: 120, y: 150, side: "right" }] },
  { key: "groin", label: "Groin", view: "front", dots: [{ x: 100, y: 158, side: "n/a" }] },
  { key: "quad", label: "Quad", view: "front", dots: [{ x: 83, y: 195, side: "left" }, { x: 117, y: 195, side: "right" }] },
  { key: "knee", label: "Knee", view: "front", dots: [{ x: 83, y: 244, side: "left" }, { x: 117, y: 244, side: "right" }] },
  { key: "shin", label: "Shin", view: "front", dots: [{ x: 83, y: 278, side: "left" }, { x: 117, y: 278, side: "right" }] },
  { key: "ankle_front", label: "Ankle (front)", view: "front", dots: [{ x: 83, y: 328, side: "left" }, { x: 117, y: 328, side: "right" }] },
  { key: "foot_top", label: "Top of foot", view: "front", dots: [{ x: 83, y: 347, side: "left" }, { x: 117, y: 347, side: "right" }] },

  // ---- back ----
  { key: "upper_back", label: "Upper back", view: "back", dots: [{ x: 100, y: 80, side: "n/a" }] },
  { key: "lower_back", label: "Lower back", view: "back", dots: [{ x: 100, y: 118, side: "n/a" }] },
  { key: "glute", label: "Glute", view: "back", dots: [{ x: 80, y: 150, side: "left" }, { x: 120, y: 150, side: "right" }] },
  { key: "hamstring", label: "Hamstring", view: "back", dots: [{ x: 83, y: 195, side: "left" }, { x: 117, y: 195, side: "right" }] },
  { key: "calf", label: "Calf", view: "back", dots: [{ x: 83, y: 278, side: "left" }, { x: 117, y: 278, side: "right" }] },
  { key: "achilles", label: "Achilles", view: "back", dots: [{ x: 83, y: 328, side: "left" }, { x: 117, y: 328, side: "right" }] },
  { key: "heel", label: "Heel", view: "back", dots: [{ x: 83, y: 344, side: "left" }, { x: 117, y: 344, side: "right" }] },
  { key: "sole", label: "Sole of foot", view: "back", dots: [{ x: 83, y: 358, side: "left" }, { x: 117, y: 358, side: "right" }] },
];

export function regionLabel(key: string | null | undefined): string {
  if (!key) return "";
  return BODY_REGIONS.find((r) => r.key === key)?.label ?? key;
}

export function regionView(key: string | null | undefined): BodyView {
  return BODY_REGIONS.find((r) => r.key === key)?.view ?? "front";
}

// The figure itself — arms straight down at the sides, identical outline
// for front and back (only the region labels differ). No text/labels
// baked in here; hotspots are drawn by the caller so the same silhouette
// can serve both the static icon and the interactive picker.
function BodySilhouette() {
  return (
    <g className="fill-muted/40 stroke-muted-foreground/25" strokeWidth="2">
      <circle cx="100" cy="25" r="18" />
      <rect x="92" y="42" width="16" height="10" rx="4" />
      <rect x="68" y="52" width="64" height="90" rx="18" />
      <rect x="68" y="142" width="64" height="26" rx="13" />
      {/* left-drawn arm */}
      <rect x="40" y="55" width="22" height="55" rx="10" />
      <rect x="38" y="112" width="20" height="55" rx="10" />
      <circle cx="48" cy="178" r="12" />
      {/* right-drawn arm */}
      <rect x="138" y="55" width="22" height="55" rx="10" />
      <rect x="142" y="112" width="20" height="55" rx="10" />
      <circle cx="152" cy="178" r="12" />
      {/* left-drawn leg */}
      <rect x="70" y="168" width="26" height="70" rx="12" />
      <rect x="72" y="254" width="22" height="70" rx="10" />
      <ellipse cx="83" cy="345" rx="16" ry="8" />
      {/* right-drawn leg */}
      <rect x="104" y="168" width="26" height="70" rx="12" />
      <rect x="106" y="254" width="22" height="70" rx="10" />
      <ellipse cx="117" cy="345" rx="16" ry="8" />
    </g>
  );
}

// Small static icon for list views (InjuryCard etc.) — same figure,
// scaled down, with no interaction. When a side is known and matches one
// of the region's dots, only that dot highlights (a left calf shows just
// the left dot); otherwise every dot for the region highlights (e.g.
// side "both", or side not passed at all). Renders a plain outline with
// no highlight when there's no region set, rather than nothing, so the
// list keeps a consistent shape.
export function BodyMapIcon({
  region,
  side,
  className,
  size = "sm",
}: {
  region: string | null | undefined;
  side?: string | null;
  className?: string;
  size?: "sm" | "lg";
}) {
  const def = region ? BODY_REGIONS.find((r) => r.key === region) : undefined;
  const matchingSideDot = def?.dots.find((d) => d.side === side);
  const dotsToShow = matchingSideDot ? [matchingSideDot] : def?.dots ?? [];
  return (
    <svg viewBox="0 0 200 370" className={cn(size === "lg" ? "h-16 w-10" : "h-8 w-5", "shrink-0", className)} aria-label={def?.label ?? "Body region not set"}>
      <BodySilhouette />
      {dotsToShow.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r="11" className="fill-[var(--accent-red)]" />
      ))}
    </svg>
  );
}

// The full interactive picker — front/back toggle plus every region for
// the active view rendered as a clickable hotspot. Each dot now carries
// its own side, so clicking the left-drawn calf sets both region="calf"
// and side="left" in one action — no separate step needed for paired
// regions. Midline regions (head, chest, etc.) always report side="n/a".
// body_part free text stays alongside this on the form for the specific
// description ("Achilles", "left calf, feels tight") — this just captures
// which broad, consistent region and side it maps to.
export function BodyMapPicker({ value, onChange }: { value: BodyMapValue | null; onChange: (v: BodyMapValue) => void }) {
  const [view, setView] = useState<BodyView>(value ? regionView(value.region) : "front");
  const regions = BODY_REGIONS.filter((r) => r.view === view);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setView("front")}
            className={cn(
              "px-2.5 py-1 text-xs rounded-md border",
              view === "front" ? "bg-[var(--accent-red)] text-white border-[var(--accent-red)]" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            Front
          </button>
          <button
            type="button"
            onClick={() => setView("back")}
            className={cn(
              "px-2.5 py-1 text-xs rounded-md border",
              view === "back" ? "bg-[var(--accent-red)] text-white border-[var(--accent-red)]" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            Back
          </button>
        </div>
        {value && (
          <span className="text-xs text-muted-foreground">
            Selected: {regionLabel(value.region)}{value.side !== "n/a" && ` (${value.side})`}
          </span>
        )}
      </div>
      <svg viewBox="0 0 200 370" className="w-full max-w-[220px] mx-auto block">
        <BodySilhouette />
        {regions.map((r) =>
          r.dots.map((d, i) => {
            const selected = value?.region === r.key && value?.side === d.side;
            const label = d.side === "n/a" ? r.label : `${r.label} (${d.side})`;
            return (
              <circle
                key={`${r.key}-${i}`}
                cx={d.x}
                cy={d.y}
                r="11"
                tabIndex={0}
                role="button"
                aria-label={label}
                onClick={() => onChange({ region: r.key, side: d.side })}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onChange({ region: r.key, side: d.side }); }}
                className={cn(
                  "cursor-pointer transition-colors outline-none focus-visible:stroke-2 focus-visible:stroke-foreground",
                  selected ? "fill-[var(--accent-red)]" : "fill-muted-foreground/30 hover:fill-muted-foreground/60",
                )}
              >
                <title>{label}</title>
              </circle>
            );
          }),
        )}
      </svg>
    </div>
  );
}
