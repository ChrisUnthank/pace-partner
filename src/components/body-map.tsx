import { useState } from "react";
import { cn } from "@/lib/utils";

export type BodyView = "front" | "back";

export interface BodyRegionDef {
  key: string;
  label: string;
  view: BodyView;
  // Paired regions (e.g. calf) get a dot drawn on both legs/arms of the
  // schematic figure for visual completeness — a real body has two of
  // them — but both dots click through to the same region key. Side
  // (left/right/both) stays a separate field on the injury form; the
  // diagram picks *what*, not *which side*.
  dots: { x: number; y: number }[];
}

// One shared coordinate set for a simple front-facing schematic figure
// (arms straight down at the sides, the standard convention for these
// "click where it hurts" diagrams) — reused for both the front and back
// view, since the silhouette shape itself is identical; only which
// regions are labeled changes.
export const BODY_REGIONS: BodyRegionDef[] = [
  // ---- front ----
  { key: "head", label: "Head", view: "front", dots: [{ x: 100, y: 25 }] },
  { key: "neck", label: "Neck", view: "front", dots: [{ x: 100, y: 47 }] },
  { key: "shoulder", label: "Shoulder", view: "front", dots: [{ x: 51, y: 60 }, { x: 149, y: 60 }] },
  { key: "chest", label: "Chest", view: "front", dots: [{ x: 100, y: 80 }] },
  { key: "upper_arm", label: "Upper arm", view: "front", dots: [{ x: 51, y: 88 }, { x: 149, y: 88 }] },
  { key: "elbow", label: "Elbow", view: "front", dots: [{ x: 48, y: 113 }, { x: 152, y: 113 }] },
  { key: "forearm", label: "Forearm", view: "front", dots: [{ x: 48, y: 140 }, { x: 152, y: 140 }] },
  { key: "wrist_hand", label: "Wrist / hand", view: "front", dots: [{ x: 48, y: 178 }, { x: 152, y: 178 }] },
  { key: "abdomen", label: "Abdomen", view: "front", dots: [{ x: 100, y: 118 }] },
  { key: "hip_flexor", label: "Hip flexor", view: "front", dots: [{ x: 80, y: 150 }, { x: 120, y: 150 }] },
  { key: "groin", label: "Groin", view: "front", dots: [{ x: 100, y: 158 }] },
  { key: "quad", label: "Quad", view: "front", dots: [{ x: 83, y: 195 }, { x: 117, y: 195 }] },
  { key: "knee", label: "Knee", view: "front", dots: [{ x: 83, y: 244 }, { x: 117, y: 244 }] },
  { key: "shin", label: "Shin", view: "front", dots: [{ x: 83, y: 278 }, { x: 117, y: 278 }] },
  { key: "ankle_front", label: "Ankle (front)", view: "front", dots: [{ x: 83, y: 328 }, { x: 117, y: 328 }] },
  { key: "foot_top", label: "Top of foot", view: "front", dots: [{ x: 83, y: 347 }, { x: 117, y: 347 }] },

  // ---- back ----
  { key: "upper_back", label: "Upper back", view: "back", dots: [{ x: 100, y: 80 }] },
  { key: "lower_back", label: "Lower back", view: "back", dots: [{ x: 100, y: 118 }] },
  { key: "glute", label: "Glute", view: "back", dots: [{ x: 80, y: 150 }, { x: 120, y: 150 }] },
  { key: "hamstring", label: "Hamstring", view: "back", dots: [{ x: 83, y: 195 }, { x: 117, y: 195 }] },
  { key: "calf", label: "Calf", view: "back", dots: [{ x: 83, y: 278 }, { x: 117, y: 278 }] },
  { key: "achilles", label: "Achilles", view: "back", dots: [{ x: 83, y: 328 }, { x: 117, y: 328 }] },
  { key: "heel", label: "Heel", view: "back", dots: [{ x: 83, y: 344 }, { x: 117, y: 344 }] },
  { key: "sole", label: "Sole of foot", view: "back", dots: [{ x: 83, y: 358 }, { x: 117, y: 358 }] },
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
// scaled down, with just the one region's dot(s) highlighted and no
// interaction. Renders a plain outline with no highlight when there's no
// region set, rather than nothing, so the list keeps a consistent shape.
export function BodyMapIcon({
  region,
  className,
  size = "sm",
}: {
  region: string | null | undefined;
  className?: string;
  size?: "sm" | "lg";
}) {
  const def = region ? BODY_REGIONS.find((r) => r.key === region) : undefined;
  return (
    <svg viewBox="0 0 200 370" className={cn(size === "lg" ? "h-16 w-10" : "h-8 w-5", "shrink-0", className)} aria-label={def?.label ?? "Body region not set"}>
      <BodySilhouette />
      {def?.dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r="11" className="fill-[var(--accent-red)]" />
      ))}
    </svg>
  );
}

// The full interactive picker — front/back toggle plus every region for
// the active view rendered as a clickable hotspot. Used on the New Injury
// form; body_part free text stays alongside it for the specific
// description ("Achilles", "left calf, feels tight") — this just captures
// which broad, consistent region it maps to, for the icon and any future
// pattern analysis across injuries.
export function BodyMapPicker({ value, onChange }: { value: string | null; onChange: (region: string) => void }) {
  const [view, setView] = useState<BodyView>(value ? regionView(value) : "front");
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
        {value && <span className="text-xs text-muted-foreground">Selected: {regionLabel(value)}</span>}
      </div>
      <svg viewBox="0 0 200 370" className="w-full max-w-[220px] mx-auto block">
        <BodySilhouette />
        {regions.map((r) =>
          r.dots.map((d, i) => {
            const selected = value === r.key;
            return (
              <circle
                key={`${r.key}-${i}`}
                cx={d.x}
                cy={d.y}
                r="11"
                tabIndex={0}
                role="button"
                aria-label={r.label}
                onClick={() => onChange(r.key)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onChange(r.key); }}
                className={cn(
                  "cursor-pointer transition-colors outline-none focus-visible:stroke-2 focus-visible:stroke-foreground",
                  selected ? "fill-[var(--accent-red)]" : "fill-muted-foreground/30 hover:fill-muted-foreground/60",
                )}
              >
                <title>{r.label}</title>
              </circle>
            );
          }),
        )}
      </svg>
    </div>
  );
}
