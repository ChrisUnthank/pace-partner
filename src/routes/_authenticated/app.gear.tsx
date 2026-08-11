import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyAthlete } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { todayISO } from "@/lib/format";
import { toast } from "sonner";
import {
  Star,
  Trash2,
  ChevronDown,
  ChevronUp,
  Link2,
  Footprints,
  Bike as BikeIcon,
  Activity,
  Package,
  Pencil,
  Search,
  AlertTriangle,
  Plus,
  TrendingUp,
  Zap,
  Trophy,
  Dumbbell,
  LayoutGrid,
  ListFilter,
  Layers,
  Flame,
  Gauge,
} from "lucide-react";
import { BucketTabStrip, LOCKER_TABS } from "@/components/bucket-tab-strip";
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip } from "recharts";

export const Route = createFileRoute("/_authenticated/app/gear")({
  component: GearPage,
});

// ---------------------------------------------------------------------------
// Shoe profile vocabulary — three independent axes.
//
//   SHOE_TYPES   what the shoe IS
//   SHOE_SURFACES where it's FOR
//   TRAIT_GROUPS what it's BUILT WITH
//
// (PURPOSE_GROUPS, further down, is the fourth and separate question: what
// the athlete chooses to use it for.)
//
// The legacy shoe_category / is_spike columns are still written on save,
// derived from these, because the session detail page still reads them.
// ---------------------------------------------------------------------------

const SHOE_TYPES: { value: string; label: string; colour: string; hint: string }[] = [
  { value: "spike", label: "Spike", colour: "#ef4444", hint: "Track spikes — reps, races" },
  { value: "super_racer", label: "Super racer", colour: "#a855f7", hint: "Plated race shoe, superfoam" },
  { value: "racing_flat", label: "Racing flat", colour: "#f97316", hint: "Light, unplated racer" },
  { value: "super_trainer", label: "Super trainer", colour: "#ec4899", hint: "Plated tempo/threshold trainer" },
  { value: "tempo_trainer", label: "Tempo trainer", colour: "#f59e0b", hint: "Light, firm, unplated" },
  { value: "daily_trainer", label: "Daily trainer", colour: "#10b981", hint: "Everyday mileage" },
  { value: "max_cushion", label: "Max cushion / recovery", colour: "#06b6d4", hint: "Soft, high stack, easy days" },
  { value: "trail", label: "Trail", colour: "#a16207", hint: "Off-road grip and protection" },
  { value: "gym", label: "Gym / cross-training", colour: "#3b82f6", hint: "Flat, stable, non-running" },
];

const SHOE_TYPE_LABEL: Record<string, string> = Object.fromEntries(SHOE_TYPES.map((t) => [t.value, t.label]));
const SHOE_TYPE_COLOUR: Record<string, string> = Object.fromEntries(SHOE_TYPES.map((t) => [t.value, t.colour]));

const SHOE_SURFACES: { value: string; label: string }[] = [
  { value: "track", label: "Track" },
  { value: "road", label: "Road" },
  { value: "trail", label: "Trail" },
  { value: "treadmill", label: "Treadmill" },
  { value: "gym", label: "Gym" },
  { value: "mixed", label: "Mixed" },
];

const SURFACE_LABEL: Record<string, string> = Object.fromEntries(SHOE_SURFACES.map((s) => [s.value, s.label]));

const TRAIT_GROUPS: { group: string; options: { value: string; label: string }[] }[] = [
  {
    group: "Plate",
    options: [
      { value: "carbon_plate", label: "Carbon plate" },
      { value: "nylon_plate", label: "Nylon / TPU plate" },
      { value: "midfoot_shank", label: "Midfoot shank" },
      { value: "no_plate", label: "No plate" },
    ],
  },
  {
    group: "Foam",
    options: [
      { value: "superfoam_peba", label: "Superfoam (PEBA)" },
      { value: "tpu_foam", label: "TPU foam" },
      { value: "eva_foam", label: "Standard EVA" },
    ],
  },
  {
    group: "Geometry",
    options: [
      { value: "max_cushion", label: "Max cushion" },
      { value: "low_stack", label: "Low stack" },
      { value: "rocker", label: "Rocker geometry" },
      { value: "lightweight", label: "Lightweight" },
    ],
  },
  {
    group: "Fit & support",
    options: [
      { value: "stability", label: "High stability" },
      { value: "neutral", label: "Neutral" },
      { value: "wide_fit", label: "Wide fit" },
      { value: "narrow_fit", label: "Narrow fit" },
    ],
  },
  {
    group: "Other",
    options: [
      { value: "durable_outsole", label: "Durable outsole" },
      { value: "breathable_upper", label: "Breathable upper" },
      { value: "waterproof", label: "Waterproof" },
    ],
  },
];

const ALL_TRAITS = TRAIT_GROUPS.flatMap((g) => g.options);
const TRAIT_LABEL: Record<string, string> = Object.fromEntries(ALL_TRAITS.map((o) => [o.value, o.label]));

function traitLabel(v: string): string {
  return TRAIT_LABEL[v] ?? v.replace(/_/g, " ");
}

// Supershoe status is DERIVED, never stored. A super_racer or super_trainer
// is one by definition; anything else qualifies if it has a plate AND
// superfoam, which is the construction that actually produces the effect.
// Deriving it means it can't drift out of step with the fields it summarises
// the way a manually-ticked boolean would.
function isSuperShoe(item: { shoe_type?: string | null; shoe_traits?: string[] | null }): boolean {
  if (item.shoe_type === "super_racer" || item.shoe_type === "super_trainer") return true;
  const traits = item.shoe_traits ?? [];
  const plated = traits.includes("carbon_plate") || traits.includes("nylon_plate");
  return plated && traits.includes("superfoam_peba");
}

// The legacy columns the session detail page still reads, derived on save so
// that page keeps working untouched.
function legacyCategoryFor(surface: string | null): string | null {
  if (!surface) return null;
  if (surface === "track") return "track";
  if (surface === "road") return "road";
  if (surface === "trail") return "off_road";
  return "everyday";
}


// What a piece of gear is actually FOR, as opposed to what kind of thing it
// is. shoe_type and shoe_surface answer what sort of shoe it is; this
// answers "which sessions does it come out for", which is a
// different question and rarely has a single answer — a pair of road
// threshold shoes might also cover tempo runs and long-run pickups.
//
// Stored as text[] in gear_items.used_for (see
// supabase/migrations/20260811090000_gear-used-for.sql). Values are stable
// snake_case keys; the labels below are the only thing anyone sees, so a
// label can be reworded without touching stored data.
//
// Each group carries its own colour and icon, used consistently everywhere a
// purpose appears — the badges on a gear card, the purpose buckets panel,
// and the summary chart — so a colour always means the same kind of running
// rather than being decoration.
const PURPOSE_GROUPS: {
  key: string;
  group: string;
  colour: string;
  icon: any;
  options: { value: string; label: string }[];
}[] = [
  {
    key: "everyday",
    group: "Everyday running",
    colour: "#10b981",
    icon: Footprints,
    options: [
      { value: "easy_runs", label: "Easy runs" },
      { value: "long_runs", label: "Long runs" },
      { value: "recovery_runs", label: "Recovery runs" },
      { value: "warmup_cooldown", label: "Warm up / cool down" },
    ],
  },
  {
    key: "continuous",
    group: "Continuous efforts",
    colour: "#f59e0b",
    icon: TrendingUp,
    options: [
      { value: "tempo_runs", label: "Tempo runs" },
      { value: "threshold_runs", label: "Threshold runs" },
      { value: "progression_runs", label: "Progression runs" },
    ],
  },
  {
    key: "structured",
    group: "Structured sessions",
    colour: "#ef4444",
    icon: Zap,
    options: [
      { value: "threshold_session_road", label: "Threshold sessions (road)" },
      { value: "threshold_session_track", label: "Threshold sessions (track)" },
      { value: "track_sessions", label: "Track sessions" },
      { value: "vo2_sessions", label: "VO2 sessions" },
      { value: "speed_strides", label: "Speed / strides" },
      { value: "hill_sessions", label: "Hill sessions" },
    ],
  },
  {
    key: "racing",
    group: "Racing",
    colour: "#8b5cf6",
    icon: Trophy,
    options: [
      { value: "race_track", label: "Racing (track)" },
      { value: "race_road", label: "Racing (road)" },
      { value: "race_xc", label: "Racing (cross country)" },
    ],
  },
  {
    key: "other",
    group: "Other",
    colour: "#3b82f6",
    icon: Dumbbell,
    options: [
      { value: "gym", label: "Gym" },
      { value: "treadmill", label: "Treadmill" },
      { value: "trail_offroad", label: "Trail / off-road" },
    ],
  },
];

const ALL_PURPOSES = PURPOSE_GROUPS.flatMap((g) => g.options);
const PURPOSE_LABEL: Record<string, string> = Object.fromEntries(ALL_PURPOSES.map((o) => [o.value, o.label]));
const PURPOSE_COLOUR: Record<string, string> = Object.fromEntries(
  PURPOSE_GROUPS.flatMap((g) => g.options.map((o) => [o.value, g.colour])),
);

function purposeLabel(v: string): string {
  // Falls back to the raw value rather than hiding it, so a purpose removed
  // from the vocabulary later still shows something rather than vanishing
  // silently off a gear card.
  return PURPOSE_LABEL[v] ?? v.replace(/_/g, " ");
}

function purposeColour(v: string): string {
  return PURPOSE_COLOUR[v] ?? "#94a3b8";
}

// Tinted badge styling from a group colour. Inline styles rather than
// Tailwind classes because the colours come from data, and Tailwind can't
// generate classes it never sees in source at build time.
function tintStyle(colour: string) {
  return { color: colour, borderColor: `${colour}59`, background: `${colour}14` };
}

// Curated per-type dropdown + "Other" for anything not listed — the
// athlete always types the specific model themselves regardless of brand.
const BRANDS_BY_TYPE: Record<string, string[]> = {
  shoe: [
    "Nike",
    "Adidas",
    "ASICS",
    "Brooks",
    "Hoka",
    "New Balance",
    "Saucony",
    "Mizuno",
    "On",
    "Salomon",
    "Altra",
    "Puma",
    "Under Armour",
    "Reebok",
    "Other",
  ],
  bike: ["Trek", "Specialized", "Cannondale", "Giant", "Cervélo", "Scott", "Bianchi", "Canyon", "Other"],
  treadmill: ["NordicTrack", "Woodway", "Peloton", "Technogym", "Life Fitness", "Sole", "Other"],
  other: ["Other"],
};

const TYPE_ICON: Record<string, any> = { shoe: Footprints, bike: BikeIcon, treadmill: Activity, other: Package };

const TYPE_LABEL: Record<string, string> = {
  shoe: "Shoes",
  bike: "Bikes",
  treadmill: "Treadmills",
  other: "Other gear",
};

function km(m: number): number {
  return m / 1000;
}

// ----------------------------------------------------------------------------
// Shared form shape — used by BOTH the add dialog and the edit dialog, so the
// two can't drift apart the way they would as two hand-maintained copies.
// ----------------------------------------------------------------------------

type GearDraft = {
  gear_type: string;
  shoe_type: string;
  shoe_surface: string;
  shoe_traits: string[];
  stack_height_mm: string;
  drop_mm: string;
  weight_g: string;
  description: string;
  brand: string;
  customBrand: string;
  model: string;
  nickname: string;
  purchase_date: string;
  retirement_target_km: string;
  notes: string;
  used_for: string[];
};

function emptyDraft(): GearDraft {
  return {
    gear_type: "shoe",
    shoe_type: "",
    shoe_surface: "",
    shoe_traits: [],
    stack_height_mm: "",
    drop_mm: "",
    weight_g: "",
    description: "",
    brand: BRANDS_BY_TYPE.shoe[0],
    customBrand: "",
    model: "",
    nickname: "",
    purchase_date: "",
    retirement_target_km: "",
    notes: "",
    used_for: [],
  };
}

function draftFromItem(item: any): GearDraft {
  const type = item.gear_type ?? "other";
  const known = BRANDS_BY_TYPE[type] ?? BRANDS_BY_TYPE.other;
  // A brand saved as free text (entered via "Other") won't be in the curated
  // list — reopening it as "Other" + custom text preserves it rather than
  // silently snapping to the first brand in the dropdown on save.
  const brandIsKnown = known.includes(item.brand);
  return {
    gear_type: type,
    shoe_type: item.shoe_type ?? "",
    shoe_surface: item.shoe_surface ?? "",
    shoe_traits: Array.isArray(item.shoe_traits) ? item.shoe_traits : [],
    stack_height_mm: item.stack_height_mm == null ? "" : String(item.stack_height_mm),
    drop_mm: item.drop_mm == null ? "" : String(item.drop_mm),
    weight_g: item.weight_g == null ? "" : String(item.weight_g),
    description: item.description ?? "",
    brand: brandIsKnown ? item.brand : "Other",
    customBrand: brandIsKnown ? "" : (item.brand ?? ""),
    model: item.model ?? "",
    nickname: item.nickname ?? "",
    purchase_date: item.purchase_date ?? "",
    retirement_target_km: item.retirement_target_km == null ? "" : String(item.retirement_target_km),
    notes: item.notes ?? "",
    used_for: Array.isArray(item.used_for) ? item.used_for : [],
  };
}

function draftToPayload(d: GearDraft, athleteId: string) {
  const finalBrand = d.brand === "Other" ? d.customBrand.trim() || "Other" : d.brand;
  const isShoe = d.gear_type === "shoe";
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  return {
    athlete_id: athleteId,
    gear_type: d.gear_type,
    shoe_type: isShoe ? d.shoe_type || null : null,
    shoe_surface: isShoe ? d.shoe_surface || null : null,
    shoe_traits: isShoe ? d.shoe_traits : [],
    stack_height_mm: isShoe ? num(d.stack_height_mm) : null,
    drop_mm: isShoe ? num(d.drop_mm) : null,
    weight_g: isShoe ? num(d.weight_g) : null,
    description: d.description || null,
    // Legacy columns, derived — the session detail page still reads them.
    shoe_category: isShoe ? legacyCategoryFor(d.shoe_surface || null) : null,
    is_spike: isShoe && d.shoe_type === "spike",
    brand: finalBrand,
    model: d.model.trim(),
    nickname: d.nickname || null,
    purchase_date: d.purchase_date || null,
    retirement_target_km: d.retirement_target_km === "" ? null : Number(d.retirement_target_km),
    notes: d.notes || null,
    // Purposes are a shoe concept — a bike or treadmill keeps an empty array
    // rather than inheriting whatever was ticked before the type changed.
    used_for: d.gear_type === "shoe" ? d.used_for : [],
  };
}

// ----------------------------------------------------------------------------
// Purpose picker — multi-select checkboxes, grouped and colour-coded.
// ----------------------------------------------------------------------------

function PurposePicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Label className="text-xs flex items-center gap-1.5">
          <ListFilter className="h-3.5 w-3.5" /> Used for
        </Label>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground tabular-nums">{value.length} selected</span>
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[11px] text-muted-foreground hover:text-foreground underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      <div className="rounded-md border max-h-[300px] overflow-y-auto brand-scrollbar divide-y">
        {PURPOSE_GROUPS.map((g) => {
          const Icon = g.icon;
          return (
            <div key={g.key} className="p-2.5">
              <div
                className="text-[10px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1.5"
                style={{ color: g.colour }}
              >
                <Icon className="h-3 w-3" /> {g.group}
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-3 gap-y-1.5">
                {g.options.map((o) => (
                  <label key={o.value} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={value.includes(o.value)} onCheckedChange={() => toggle(o.value)} />
                    <span className="min-w-0 truncate">{o.label}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">
        Tick everything the shoe genuinely comes out for — most shoes cover more than one.
      </p>
    </div>
  );
}

// Sensible starting purposes for each shoe type. Applied ONLY when nothing
// has been ticked yet — it's a head start, never an override of a choice the
// athlete has already made.
const DEFAULT_PURPOSES_BY_TYPE: Record<string, string[]> = {
  spike: ["track_sessions", "vo2_sessions", "speed_strides", "race_track"],
  super_racer: ["race_road", "race_track"],
  racing_flat: ["race_road", "race_xc", "threshold_session_road"],
  super_trainer: ["tempo_runs", "threshold_runs", "threshold_session_road", "progression_runs"],
  tempo_trainer: ["tempo_runs", "threshold_runs", "progression_runs"],
  daily_trainer: ["easy_runs", "long_runs", "warmup_cooldown"],
  max_cushion: ["recovery_runs", "easy_runs", "long_runs"],
  trail: ["trail_offroad", "easy_runs"],
  gym: ["gym"],
};

// ----------------------------------------------------------------------------
// Trait picker — grouped checkboxes, same shape as the purpose picker.
// ----------------------------------------------------------------------------

function TraitPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Label className="text-xs flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5" /> Features
        </Label>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground tabular-nums">{value.length} selected</span>
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[11px] text-muted-foreground hover:text-foreground underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      <div className="rounded-md border divide-y">
        {TRAIT_GROUPS.map((g) => (
          <div key={g.group} className="p-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
              {g.group}
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-3 gap-y-1.5">
              {g.options.map((o) => (
                <label key={o.value} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={value.includes(o.value)} onCheckedChange={() => toggle(o.value)} />
                  <span className="min-w-0 truncate">{o.label}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Shared field set
// ----------------------------------------------------------------------------

function GearFormFields({ draft, setDraft }: { draft: GearDraft; setDraft: (next: GearDraft) => void }) {
  function set<K extends keyof GearDraft>(key: K, val: GearDraft[K]) {
    setDraft({ ...draft, [key]: val });
  }

  function changeType(t: string) {
    setDraft({
      ...draft,
      gear_type: t,
      brand: (BRANDS_BY_TYPE[t] ?? BRANDS_BY_TYPE.other)[0],
      customBrand: "",
    });
  }

  // Picking a shoe type pre-ticks a sensible set of purposes, but only when
  // nothing has been ticked yet — switching type later never wipes choices
  // already made.
  function changeShoeType(t: string) {
    const suggested = DEFAULT_PURPOSES_BY_TYPE[t] ?? [];
    setDraft({
      ...draft,
      shoe_type: t,
      used_for: draft.used_for.length === 0 ? suggested : draft.used_for,
    });
  }

  const superShoe = draft.gear_type === "shoe" && isSuperShoe({ shoe_type: draft.shoe_type, shoe_traits: draft.shoe_traits });

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <Label className="text-xs">Type</Label>
          <Select value={draft.gear_type} onValueChange={changeType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="shoe">Shoe</SelectItem>
              <SelectItem value="bike">Bike</SelectItem>
              <SelectItem value="treadmill">Treadmill</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {draft.gear_type === "shoe" && (
          <>
            <div>
              <Label className="text-xs">Shoe type</Label>
              <Select value={draft.shoe_type} onValueChange={changeShoeType}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a type…" />
                </SelectTrigger>
                <SelectContent>
                  {SHOE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full inline-block" style={{ background: t.colour }} />
                        {t.label}
                        <span className="text-muted-foreground text-[11px]">— {t.hint}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Surface</Label>
              <Select value={draft.shoe_surface} onValueChange={(v) => set("shoe_surface", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a surface…" />
                </SelectTrigger>
                <SelectContent>
                  {SHOE_SURFACES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
        <div>
          <Label className="text-xs">Brand</Label>
          <Select value={draft.brand} onValueChange={(v) => set("brand", v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(BRANDS_BY_TYPE[draft.gear_type] ?? BRANDS_BY_TYPE.other).map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {draft.brand === "Other" && (
          <div>
            <Label className="text-xs">Brand name</Label>
            <Input value={draft.customBrand} onChange={(e) => set("customBrand", e.target.value)} placeholder="Brand" />
          </div>
        )}
        <div>
          <Label className="text-xs">Model</Label>
          <Input value={draft.model} onChange={(e) => set("model", e.target.value)} placeholder="e.g. Vaporfly 3" />
        </div>
        <div>
          <Label className="text-xs">Nickname (optional)</Label>
          <Input value={draft.nickname} onChange={(e) => set("nickname", e.target.value)} placeholder="e.g. Race day" />
        </div>
        <div>
          <Label className="text-xs">Purchase date (optional)</Label>
          <Input
            type="date"
            value={draft.purchase_date}
            max={todayISO()}
            onChange={(e) => set("purchase_date", e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">Retirement target — km (optional)</Label>
          <Input
            type="number"
            value={draft.retirement_target_km}
            onChange={(e) => set("retirement_target_km", e.target.value)}
            placeholder="600"
          />
        </div>
        {draft.gear_type === "shoe" && (
          <>
            <div>
              <Label className="text-xs">Stack height — mm (optional)</Label>
              <Input
                type="number"
                value={draft.stack_height_mm}
                onChange={(e) => set("stack_height_mm", e.target.value)}
                placeholder="40"
              />
            </div>
            <div>
              <Label className="text-xs">Drop — mm (optional)</Label>
              <Input
                type="number"
                value={draft.drop_mm}
                onChange={(e) => set("drop_mm", e.target.value)}
                placeholder="8"
              />
            </div>
            <div>
              <Label className="text-xs">Weight — g (optional)</Label>
              <Input
                type="number"
                value={draft.weight_g}
                onChange={(e) => set("weight_g", e.target.value)}
                placeholder="215"
              />
            </div>
          </>
        )}
      </div>

      {superShoe && (
        <div className="flex items-center gap-2 text-xs rounded-md border px-3 py-2" style={tintStyle("#a855f7")}>
          <Zap className="h-3.5 w-3.5 shrink-0" />
          <span>
            Counts as a <strong>supershoe</strong> — plated with superfoam. Worked out from the type and features
            above rather than set separately, so it can't end up disagreeing with them.
          </span>
        </div>
      )}

      {draft.gear_type === "shoe" && <TraitPicker value={draft.shoe_traits} onChange={(v) => set("shoe_traits", v)} />}

      {draft.gear_type === "shoe" && <PurposePicker value={draft.used_for} onChange={(v) => set("used_for", v)} />}

      <div>
        <Label className="text-xs">What it's designed for (optional)</Label>
        <Textarea
          className="mt-1"
          placeholder="e.g. Plated road racer for 10k to marathon — very light, aggressive rocker, not much use below tempo pace."
          value={draft.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </div>

      <div>
        <Label className="text-xs">Your notes (optional)</Label>
        <Textarea
          className="mt-1"
          placeholder="How they've felt, any niggles, when you'd reach for them"
          value={draft.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Add / edit dialogs — same field set, same component, different verb.
// ----------------------------------------------------------------------------

function GearAddDialog({
  athleteId,
  open,
  onOpenChange,
}: {
  athleteId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<GearDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);

  function handleOpenChange(v: boolean) {
    // Fresh form every time it opens, so a half-filled abandoned entry
    // doesn't reappear next time.
    if (v) setDraft(emptyDraft());
    onOpenChange(v);
  }

  async function save() {
    if (!draft.model.trim()) {
      toast.error("Model is required");
      return;
    }
    setSaving(true);
    // `used_for` was added by manually-run SQL rather than Lovable's
    // migration flow, so it isn't in the generated Supabase types yet —
    // hence the cast, the same convention used elsewhere in the app.
    const { error } = await (supabase as any).from("gear_items").insert(draftToPayload(draft, athleteId));
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Gear added");
    qc.invalidateQueries({ queryKey: ["gear-list", athleteId] });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add gear
          </DialogTitle>
          <DialogDescription>Shoes, bike, treadmill or anything else worth tracking mileage on.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[68vh] overflow-y-auto brand-scrollbar pr-1">
          <GearFormFields draft={draft} setDraft={setDraft} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save gear"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GearEditDialog({
  item,
  athleteId,
  open,
  onOpenChange,
}: {
  item: any;
  athleteId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<GearDraft>(() => draftFromItem(item));
  const [saving, setSaving] = useState(false);

  // Re-seed from the item every time the dialog is opened, so reopening
  // after a cancel shows the saved values rather than the abandoned edit.
  function handleOpenChange(v: boolean) {
    if (v) setDraft(draftFromItem(item));
    onOpenChange(v);
  }

  async function save() {
    if (!draft.model.trim()) {
      toast.error("Model is required");
      return;
    }
    setSaving(true);
    const payload = draftToPayload(draft, athleteId);
    // athlete_id is deliberately not updatable — it's ownership, not a field.
    delete (payload as any).athlete_id;
    const { error } = await (supabase as any).from("gear_items").update(payload).eq("id", item.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Gear updated");
    qc.invalidateQueries({ queryKey: ["gear-list", athleteId] });
    qc.invalidateQueries({ queryKey: ["gear-usage", athleteId] });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" /> Edit gear
          </DialogTitle>
          <DialogDescription>Changes here don't affect linked sessions or accumulated distance.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[68vh] overflow-y-auto brand-scrollbar pr-1">
          <GearFormFields draft={draft} setDraft={setDraft} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------

function GearPage() {
  const { data: athlete, isLoading } = useMyAthlete();
  const [adding, setAdding] = useState(false);

  if (isLoading)
    return (
      <AppShell fullWidth>
        <p>Loading…</p>
      </AppShell>
    );
  if (!athlete)
    return (
      <AppShell fullWidth>
        <p className="text-sm">
          No athlete profile linked. Visit{" "}
          <Link to="/app/account" className="underline">
            Account
          </Link>
          .
        </p>
      </AppShell>
    );

  return (
    <AppShell fullWidth>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
              style={{ background: "var(--accent-red)" }}
            >
              <Footprints className="h-5 w-5 text-white" strokeWidth={2} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Locker</div>
              <h1 className="text-2xl font-bold leading-tight">Gear</h1>
              <p className="text-sm text-muted-foreground">
                Track shoes, bike, and other kit — say what each pair is for, rate them, mark favourites, and see how
                far each one's actually gone.
              </p>
            </div>
          </div>
          <Button
            size="lg"
            onClick={() => setAdding(true)}
            className="h-12 px-6 text-base font-semibold w-full sm:w-auto shrink-0"
          >
            <Plus className="h-5 w-5 mr-2" /> Add gear
          </Button>
        </div>
        <BucketTabStrip items={LOCKER_TABS} active="/app/gear" />
        <GearList athleteId={athlete.id} />
        <GearAddDialog athleteId={athlete.id} open={adding} onOpenChange={setAdding} />
      </div>
    </AppShell>
  );
}

// ----------------------------------------------------------------------------
// Locker overview — headline numbers, breakdowns, and things needing attention.
//
// Covers ALL gear types, not just shoes: the by-type block is the top-level
// view, and the category/purpose breakdowns below it are shoe-specific
// simply because those two fields only exist on shoes.
// ----------------------------------------------------------------------------

function GearSummary({
  items,
  usageByGear,
  distinctSessionM,
  summedGearM,
}: {
  items: any[];
  usageByGear: Map<string, { totalM: number; count: number }>;
  distinctSessionM: number;
  summedGearM: number;
}) {
  const stats = useMemo(() => {
    const retired = items.filter((g) => g.is_retired);

    const byType = new Map<string, { count: number; active: number; totalM: number }>();
    for (const g of items) {
      const t = g.gear_type ?? "other";
      const cur = byType.get(t) ?? { count: 0, active: 0, totalM: 0 };
      cur.count += 1;
      if (!g.is_retired) cur.active += 1;
      cur.totalM += usageByGear.get(g.id)?.totalM ?? 0;
      byType.set(t, cur);
    }

    const shoes = items.filter((g) => g.gear_type === "shoe");

    // By shoe TYPE — distance is meaningful here because a shoe has exactly
    // one type, so nothing is counted twice (unlike purposes).
    const byType2 = new Map<string, { count: number; totalM: number }>();
    for (const g of shoes) {
      const c = g.shoe_type ?? "unset";
      const cur = byType2.get(c) ?? { count: 0, totalM: 0 };
      cur.count += 1;
      cur.totalM += usageByGear.get(g.id)?.totalM ?? 0;
      byType2.set(c, cur);
    }

    const superShoes = shoes.filter((g) => isSuperShoe(g));
    const superM = superShoes.reduce((sum, g) => sum + (usageByGear.get(g.id)?.totalM ?? 0), 0);

    // By purpose GROUP — COUNT of shoes only, deliberately not distance. A
    // shoe tagged across several groups would contribute its full mileage to
    // each, producing a chart whose bars sum to several times the real
    // distance. Counting pairs is the honest version of this question.
    const byGroup = new Map<string, number>();
    for (const g of shoes) {
      const groups = new Set<string>();
      for (const p of (g.used_for ?? []) as string[]) {
        const grp = PURPOSE_GROUPS.find((x) => x.options.some((o) => o.value === p));
        if (grp) groups.add(grp.key);
      }
      for (const k of groups) byGroup.set(k, (byGroup.get(k) ?? 0) + 1);
    }

    const withTarget = shoes
      .map((g) => {
        const totalM = usageByGear.get(g.id)?.totalM ?? 0;
        const target = g.retirement_target_km == null ? null : Number(g.retirement_target_km);
        return { g, totalKm: km(totalM), target, pct: target ? (km(totalM) / target) * 100 : null };
      })
      .filter((x) => x.pct != null && !x.g.is_retired) as {
      g: any;
      totalKm: number;
      target: number;
      pct: number;
    }[];

    return {
      total: items.length,
      active: items.length - retired.length,
      retired: retired.length,
      byType: Array.from(byType.entries()).sort((a, b) => b[1].totalM - a[1].totalM),
      byShoeType: Array.from(byType2.entries()).sort((a, b) => b[1].totalM - a[1].totalM),
      superShoeCount: superShoes.length,
      superShoeM: superM,
      noType: shoes.filter((g) => !g.is_retired && !g.shoe_type),
      byGroup,
      pastTarget: withTarget.filter((x) => x.pct >= 100).sort((a, b) => b.pct - a.pct),
      nearingTarget: withTarget.filter((x) => x.pct >= 80 && x.pct < 100).sort((a, b) => b.pct - a.pct),
      noPurpose: shoes.filter((g) => !g.is_retired && ((g.used_for ?? []) as string[]).length === 0),
      neverUsed: items.filter((g) => !g.is_retired && (usageByGear.get(g.id)?.count ?? 0) === 0),
      mostUsed: items
        .map((g) => ({ g, totalM: usageByGear.get(g.id)?.totalM ?? 0 }))
        .sort((a, b) => b.totalM - a.totalM)
        .filter((x) => x.totalM > 0)
        .slice(0, 4),
      shoeCount: shoes.length,
    };
  }, [items, usageByGear]);

  const typeChart = stats.byShoeType.map(([c, v]) => ({
    name: SHOE_TYPE_LABEL[c] ?? (c === "unset" ? "Not set" : c),
    km: Math.round(km(v.totalM)),
    count: v.count,
    fill: SHOE_TYPE_COLOUR[c] ?? "#94a3b8",
  }));

  const groupChart = PURPOSE_GROUPS.filter((g) => (stats.byGroup.get(g.key) ?? 0) > 0).map((g) => ({
    name: g.group,
    shoes: stats.byGroup.get(g.key) ?? 0,
    fill: g.colour,
  }));

  // If the same session is tagged to more than one item, every one of them is
  // credited the session's full distance — so per-gear totals can add up to
  // more than the athlete has actually covered. Surfaced rather than quietly
  // papered over, because it also inflates retirement progress.
  const overlapM = Math.max(0, summedGearM - distinctSessionM);
  const hasOverlap = distinctSessionM > 0 && overlapM / distinctSessionM > 0.02;

  const attention =
    stats.pastTarget.length + stats.nearingTarget.length + stats.noPurpose.length + stats.neverUsed.length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <LayoutGrid className="h-4 w-4 text-[var(--accent-red)]" /> Locker overview
        </CardTitle>
        <CardDescription>Everything in the locker at a glance — all gear types, not just shoes.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <div className="border rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Package className="h-3 w-3" /> items
            </div>
            <div className="text-2xl font-bold tabular-nums">{stats.total}</div>
            <div className="text-[11px] text-muted-foreground">
              {stats.retired > 0 ? `${stats.retired} retired` : "none retired"}
            </div>
          </div>
          <div className="border rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Activity className="h-3 w-3" /> in rotation
            </div>
            <div className="text-2xl font-bold tabular-nums">{stats.active}</div>
            <div className="text-[11px] text-muted-foreground">active items</div>
          </div>
          <div className="border rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Gauge className="h-3 w-3" /> distance
            </div>
            <div className="text-2xl font-bold tabular-nums">{Math.round(km(distinctSessionM)).toLocaleString()}</div>
            <div className="text-[11px] text-muted-foreground">km across tagged sessions</div>
          </div>
          <div className="border rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Zap className="h-3 w-3" /> supershoes
            </div>
            <div className="text-2xl font-bold tabular-nums">{stats.superShoeCount}</div>
            <div className="text-[11px] text-muted-foreground">
              {stats.superShoeCount > 0
                ? `${Math.round(km(stats.superShoeM)).toLocaleString()} km in plated foam`
                : "none in the locker"}
            </div>
          </div>
        </div>

        {hasOverlap && (
          <div className="flex items-start gap-2 text-[11px] text-muted-foreground border rounded-md p-2.5 bg-amber-500/5 border-amber-500/30">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-px" />
            <span>
              Per-item totals add up to {Math.round(km(summedGearM)).toLocaleString()} km against{" "}
              {Math.round(km(distinctSessionM)).toLocaleString()} km of actual tagged sessions. Where two items are
              linked to the same session, each is currently credited the full distance — so individual km figures and
              retirement progress read high for those. Worth knowing before acting on a retirement warning.
            </span>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-5">
          {stats.byType.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <Package className="h-3 w-3" /> By gear type
              </div>
              <div className="space-y-1.5">
                {stats.byType.map(([t, v]) => {
                  const share = summedGearM > 0 ? (v.totalM / summedGearM) * 100 : 0;
                  const Icon = TYPE_ICON[t] ?? Package;
                  return (
                    <div key={t} className="flex items-center gap-2 text-sm">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="w-20 shrink-0 truncate text-xs">{TYPE_LABEL[t] ?? t}</span>
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden min-w-[30px]">
                        <div className="h-full bg-[var(--accent-red)]" style={{ width: `${share}%` }} />
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0 text-right">
                        {v.count} · {Math.round(km(v.totalM)).toLocaleString()}km
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {typeChart.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <Footprints className="h-3 w-3" /> Shoes by type — km
              </div>
              <div style={{ height: Math.max(110, typeChart.length * 32) }} className="w-full">
                <ResponsiveContainer>
                  <BarChart data={typeChart} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={112} />
                    <Tooltip
                      cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                      contentStyle={{
                        background: "hsl(var(--background))",
                        border: "1px solid hsl(var(--border))",
                        fontSize: 11,
                      }}
                      formatter={(v: any, _n: any, p: any) => [
                        `${Number(v).toLocaleString()} km · ${p?.payload?.count} pair(s)`,
                        "Total",
                      ]}
                    />
                    <Bar dataKey="km" radius={[0, 4, 4, 0]}>
                      {typeChart.map((d) => (
                        <Cell key={d.name} fill={d.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {groupChart.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <ListFilter className="h-3 w-3" /> Shoes by purpose group — pairs
              </div>
              <div style={{ height: Math.max(110, groupChart.length * 32) }} className="w-full">
                <ResponsiveContainer>
                  <BarChart data={groupChart} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={112} />
                    <Tooltip
                      cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                      contentStyle={{
                        background: "hsl(var(--background))",
                        border: "1px solid hsl(var(--border))",
                        fontSize: 11,
                      }}
                      formatter={(v: any) => [`${v} pair(s)`, "Covered by"]}
                    />
                    <Bar dataKey="shoes" radius={[0, 4, 4, 0]}>
                      {groupChart.map((d) => (
                        <Cell key={d.name} fill={d.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
                Counts pairs, not distance — a shoe covering several groups would otherwise add its full mileage to
                each.
              </p>
            </div>
          )}
        </div>

        <div className="grid lg:grid-cols-2 gap-5">
          {stats.mostUsed.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <Flame className="h-3 w-3" /> Most used
              </div>
              <div className="space-y-1">
                {stats.mostUsed.map(({ g, totalM }) => {
                  const Icon = TYPE_ICON[g.gear_type] ?? Package;
                  return (
                    <div key={g.id} className="flex items-center gap-2 text-sm">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate flex-1">{g.nickname || `${g.brand} ${g.model}`}</span>
                      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                        {Math.round(km(totalM)).toLocaleString()} km
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {attention > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3" /> Worth a look
              </div>
              <div className="space-y-1 text-sm">
                {stats.pastTarget.map((x) => (
                  <div key={x.g.id} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                    <span className="truncate">
                      {x.g.nickname || `${x.g.brand} ${x.g.model}`} is past its {x.target} km target (
                      {Math.round(x.totalKm).toLocaleString()} km)
                    </span>
                  </div>
                ))}
                {stats.nearingTarget.map((x) => (
                  <div key={x.g.id} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                    <span className="truncate">
                      {x.g.nickname || `${x.g.brand} ${x.g.model}`} is at {Math.round(x.pct)}% of its {x.target} km
                      target
                    </span>
                  </div>
                ))}
                {stats.noType.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                    <span>
                      {stats.noType.length} shoe{stats.noType.length === 1 ? " has" : "s have"} no type set yet
                    </span>
                  </div>
                )}
                {stats.noPurpose.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                    <span>
                      {stats.noPurpose.length} shoe{stats.noPurpose.length === 1 ? " has" : "s have"} no purpose set yet
                    </span>
                  </div>
                )}
                {stats.neverUsed.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                    <span>
                      {stats.neverUsed.length} item{stats.neverUsed.length === 1 ? " has" : "s have"} no linked sessions
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Purpose buckets — the same shoes, organised by what they're FOR rather than
// what they are. Sits alongside the main list rather than replacing it: the
// list answers "what do I own", this answers "what have I got for VO2 reps",
// which is the question you have when planning a session.
//
// A shoe appears under every purpose it's tagged for — that's the point, not
// a bug, so nothing here sums distance (see the note on the summary chart).
// ----------------------------------------------------------------------------

function PurposeBuckets({
  shoes,
  usageByGear,
  onPickPurpose,
  activePurpose,
}: {
  shoes: any[];
  usageByGear: Map<string, { totalM: number; count: number }>;
  onPickPurpose: (v: string) => void;
  activePurpose: string;
}) {
  const byPurpose = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const g of shoes) {
      for (const p of (g.used_for ?? []) as string[]) {
        const arr = m.get(p) ?? [];
        arr.push(g);
        m.set(p, arr);
      }
    }
    return m;
  }, [shoes]);

  const anyTagged = byPurpose.size > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ListFilter className="h-4 w-4 text-[var(--accent-red)]" /> By purpose
        </CardTitle>
        <CardDescription>
          What's available for each kind of session. Tap a purpose to filter the list.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!anyTagged && (
          <p className="text-sm text-muted-foreground">
            No shoes have a purpose set yet. Edit a shoe and tick what it's used for.
          </p>
        )}
        {PURPOSE_GROUPS.map((grp) => {
          const Icon = grp.icon;
          const rows = grp.options
            .map((o) => ({ o, list: byPurpose.get(o.value) ?? [] }))
            .filter((r) => r.list.length > 0);
          const pairCount = new Set(rows.flatMap((r) => r.list.map((g: any) => g.id))).size;
          return (
            <div key={grp.key} className="rounded-lg border overflow-hidden">
              <div
                className="px-3 py-2 flex items-center gap-2 border-b"
                style={{ background: `${grp.colour}14`, borderColor: `${grp.colour}33` }}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: grp.colour }} />
                <span className="text-xs font-bold uppercase tracking-wide" style={{ color: grp.colour }}>
                  {grp.group}
                </span>
                <Badge variant="outline" className="ml-auto text-[10px]" style={tintStyle(grp.colour)}>
                  {pairCount} pair{pairCount === 1 ? "" : "s"}
                </Badge>
              </div>
              {rows.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-muted-foreground">Nothing tagged for this yet.</div>
              ) : (
                <div className="divide-y">
                  {rows.map(({ o, list }) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => onPickPurpose(activePurpose === o.value ? "all" : o.value)}
                      className={`w-full text-left px-3 py-2 hover:bg-accent/40 transition-colors ${
                        activePurpose === o.value ? "bg-accent/50" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium flex-1 min-w-0 truncate">{o.label}</span>
                        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{list.length}</span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {list.map((g: any) => (
                          <span
                            key={g.id}
                            className={`text-[10px] rounded px-1.5 py-0.5 border ${g.is_retired ? "opacity-50" : ""}`}
                            style={tintStyle(grp.colour)}
                          >
                            {g.nickname || `${g.brand} ${g.model}`}
                            <span className="opacity-60 ml-1 tabular-nums">
                              {Math.round(km(usageByGear.get(g.id)?.totalM ?? 0))}km
                            </span>
                          </span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Collapsible group — one per gear type, plus one for retired items.
// ----------------------------------------------------------------------------

function GearGroup({
  title,
  typeKey,
  items,
  usageByGear,
  athleteId,
  defaultOpen,
}: {
  title: string;
  typeKey: string;
  items: any[];
  usageByGear: Map<string, { totalM: number; count: number }>;
  athleteId: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (items.length === 0) return null;

  const totalM = items.reduce((sum, g) => sum + (usageByGear.get(g.id)?.totalM ?? 0), 0);
  const Icon = TYPE_ICON[typeKey] ?? Package;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-left px-2 py-2 hover:bg-accent/30 rounded transition-colors border"
      >
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wide">{title}</span>
        <Badge variant="outline" className="text-[10px]">
          {items.length}
        </Badge>
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums shrink-0">
          {Math.round(km(totalM)).toLocaleString()} km
        </span>
      </button>
      {open && (
        <div className="space-y-2 pl-1">
          {items.map((g) => (
            <GearCard key={g.id} item={g} usage={usageByGear.get(g.id)} athleteId={athleteId} />
          ))}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// List — summary, then the full list beside the purpose buckets
// ----------------------------------------------------------------------------

function GearList({ athleteId }: { athleteId: string }) {
  const [purposeFilter, setPurposeFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [shoeTypeFilter, setShoeTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data: gearItems } = useQuery({
    queryKey: ["gear-list", athleteId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("gear_items")
        .select("*")
        .eq("athlete_id", athleteId)
        .order("is_retired")
        .order("gear_type")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // One row per session a gear item is linked to, carrying that session's
  // distance — summed client-side per gear_id below rather than via a
  // stored running total, so usage is always accurate even if a linked
  // session's distance is later corrected. session_id comes back too so the
  // overview can tell the difference between "total across gear" (which
  // double-counts shared sessions) and "distance actually covered".
  const { data: usageRows } = useQuery({
    queryKey: ["gear-usage", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("session_gear")
        .select("gear_id, session_id, sessions(total_distance_m)")
        .eq("athlete_id", athleteId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const usageByGear = useMemo(() => {
    const map = new Map<string, { totalM: number; count: number }>();
    for (const row of usageRows ?? []) {
      const cur = map.get(row.gear_id) ?? { totalM: 0, count: 0 };
      cur.totalM += Number((row as any).sessions?.total_distance_m ?? 0);
      cur.count += 1;
      map.set(row.gear_id, cur);
    }
    return map;
  }, [usageRows]);

  const { distinctSessionM, summedGearM } = useMemo(() => {
    const seen = new Map<string, number>();
    let summed = 0;
    for (const row of usageRows ?? []) {
      const d = Number((row as any).sessions?.total_distance_m ?? 0);
      summed += d;
      if (row.session_id) seen.set(row.session_id, d);
    }
    let distinct = 0;
    for (const d of seen.values()) distinct += d;
    return { distinctSessionM: distinct, summedGearM: summed };
  }, [usageRows]);

  // Only offer purposes something in the locker is actually tagged with — a
  // filter listing 19 options where 15 return nothing is worse than none.
  const purposesInUse = useMemo(() => {
    const set = new Set<string>();
    for (const g of gearItems ?? []) for (const p of (g.used_for ?? []) as string[]) set.add(p);
    return ALL_PURPOSES.filter((o) => set.has(o.value));
  }, [gearItems]);

  const typesInUse = useMemo(() => {
    const set = new Set<string>();
    for (const g of gearItems ?? []) set.add(g.gear_type ?? "other");
    return Array.from(set);
  }, [gearItems]);

  const shoeTypesInUse = useMemo(() => {
    const set = new Set<string>();
    for (const g of gearItems ?? []) if (g.shoe_type) set.add(g.shoe_type);
    return SHOE_TYPES.filter((t) => set.has(t.value));
  }, [gearItems]);

  const filtered = useMemo(() => {
    let out = gearItems ?? [];
    if (typeFilter !== "all") out = out.filter((g) => (g.gear_type ?? "other") === typeFilter);
    if (shoeTypeFilter === "__super__") out = out.filter((g) => g.gear_type === "shoe" && isSuperShoe(g));
    else if (shoeTypeFilter === "__none__") out = out.filter((g) => g.gear_type === "shoe" && !g.shoe_type);
    else if (shoeTypeFilter !== "all") out = out.filter((g) => g.shoe_type === shoeTypeFilter);
    if (purposeFilter === "__none__") {
      out = out.filter((g) => g.gear_type === "shoe" && ((g.used_for ?? []) as string[]).length === 0);
    } else if (purposeFilter !== "all") {
      out = out.filter((g) => ((g.used_for ?? []) as string[]).includes(purposeFilter));
    }
    const q = search.trim().toLowerCase();
    if (q) out = out.filter((g) => `${g.brand ?? ""} ${g.model ?? ""} ${g.nickname ?? ""}`.toLowerCase().includes(q));
    return out;
  }, [gearItems, purposeFilter, typeFilter, shoeTypeFilter, search]);

  if (!gearItems || gearItems.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-sm text-muted-foreground text-center">
          No gear added yet — use Add gear above to start tracking a pair.
        </CardContent>
      </Card>
    );
  }

  const activeFiltered = filtered.filter((g) => !g.is_retired);
  const retiredFiltered = filtered.filter((g) => g.is_retired);
  const filtersOn =
    typeFilter !== "all" || purposeFilter !== "all" || shoeTypeFilter !== "all" || search.trim() !== "";

  // Groups start open when the locker is small enough to scan, and closed
  // once it isn't — but a filter or search always opens them, since the
  // person has already narrowed to what they're looking for.
  const autoOpen = filtersOn || activeFiltered.length <= 8;
  const shoes = gearItems.filter((g) => g.gear_type === "shoe");

  return (
    <div className="space-y-4">
      <GearSummary
        items={gearItems}
        usageByGear={usageByGear}
        distinctSessionM={distinctSessionM}
        summedGearM={summedGearM}
      />

      <div className="grid xl:grid-cols-3 gap-4 items-start">
        <div className="xl:col-span-2 space-y-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4 text-[var(--accent-red)]" /> All gear
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2">
                <div className="relative">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search brand, model, nickname…"
                    className="pl-8 h-9 text-xs"
                  />
                </div>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All gear types</SelectItem>
                    {typesInUse.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TYPE_LABEL[t] ?? t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={shoeTypeFilter} onValueChange={setShoeTypeFilter}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any shoe type</SelectItem>
                    <SelectItem value="__super__">Supershoes only</SelectItem>
                    {shoeTypesInUse.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full inline-block" style={{ background: t.colour }} />
                          {t.label}
                        </span>
                      </SelectItem>
                    ))}
                    <SelectItem value="__none__">Shoes with no type set</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={purposeFilter} onValueChange={setPurposeFilter}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any purpose</SelectItem>
                    {purposesInUse.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="__none__">Shoes with nothing set</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {filtersOn && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {filtered.length} of {gearItems.length} shown
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setTypeFilter("all");
                      setShoeTypeFilter("all");
                      setPurposeFilter("all");
                    }}
                    className="underline hover:text-foreground"
                  >
                    Clear filters
                  </button>
                </div>
              )}

              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No gear matches those filters.</p>
              ) : (
                <div className="space-y-4">
                  {["shoe", "bike", "treadmill", "other"].map((t) => (
                    <GearGroup
                      key={t}
                      title={TYPE_LABEL[t] ?? t}
                      typeKey={t}
                      items={activeFiltered.filter((g) => (g.gear_type ?? "other") === t)}
                      usageByGear={usageByGear}
                      athleteId={athleteId}
                      defaultOpen={autoOpen}
                    />
                  ))}
                  <GearGroup
                    title="Retired"
                    typeKey="other"
                    items={retiredFiltered}
                    usageByGear={usageByGear}
                    athleteId={athleteId}
                    defaultOpen={false}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="xl:sticky xl:top-4">
          <PurposeBuckets
            shoes={shoes}
            usageByGear={usageByGear}
            onPickPurpose={setPurposeFilter}
            activePurpose={purposeFilter}
          />
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Gear card
// ----------------------------------------------------------------------------

function GearCard({
  item,
  usage,
  athleteId,
}: {
  item: any;
  usage: { totalM: number; count: number } | undefined;
  athleteId: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const Icon = TYPE_ICON[item.gear_type] ?? Package;
  const totalKm = usage ? usage.totalM / 1000 : 0;
  const pct = item.retirement_target_km ? Math.min(100, (totalKm / Number(item.retirement_target_km)) * 100) : null;
  const purposes: string[] = Array.isArray(item.used_for) ? item.used_for : [];

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["gear-list", athleteId] });
    qc.invalidateQueries({ queryKey: ["gear-usage", athleteId] });
  }

  async function toggleFavourite() {
    const { error } = await supabase.from("gear_items").update({ is_favourite: !item.is_favourite }).eq("id", item.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    invalidateAll();
  }
  async function setRating(r: number) {
    const { error } = await supabase.from("gear_items").update({ rating: r }).eq("id", item.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    invalidateAll();
  }
  async function toggleRetired() {
    const { error } = await supabase.from("gear_items").update({ is_retired: !item.is_retired }).eq("id", item.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    invalidateAll();
  }
  async function remove() {
    const { error } = await supabase.from("gear_items").delete().eq("id", item.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    invalidateAll();
  }

  const typeColour = SHOE_TYPE_COLOUR[item.shoe_type ?? ""] ?? "#94a3b8";
  const traits: string[] = Array.isArray(item.shoe_traits) ? item.shoe_traits : [];
  const superShoe = item.gear_type === "shoe" && isSuperShoe(item);
  const specBits = [
    item.stack_height_mm != null ? `${item.stack_height_mm}mm stack` : null,
    item.drop_mm != null ? `${item.drop_mm}mm drop` : null,
    item.weight_g != null ? `${item.weight_g}g` : null,
  ].filter(Boolean) as string[];

  return (
    <Card className={item.is_retired ? "opacity-60" : undefined}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 text-left min-w-0">
            {open ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <span
              className="h-8 w-8 shrink-0 rounded-md grid place-items-center"
              style={{ background: `${typeColour}1f` }}
            >
              <Icon className="h-4 w-4 shrink-0" style={{ color: typeColour }} />
            </span>
            <div className="min-w-0">
              <CardTitle className="text-base truncate">{item.nickname || `${item.brand} ${item.model}`}</CardTitle>
              <CardDescription className="truncate">
                {item.brand} {item.model}
                {item.shoe_type && ` · ${SHOE_TYPE_LABEL[item.shoe_type] ?? item.shoe_type}`}
                {item.shoe_surface && ` · ${SURFACE_LABEL[item.shoe_surface] ?? item.shoe_surface}`}
              </CardDescription>
            </div>
          </button>
          <div className="flex items-center gap-2 shrink-0">
            {item.is_retired && (
              <Badge variant="outline" className="text-[10px]">
                Retired
              </Badge>
            )}
            <button type="button" onClick={() => setEditing(true)} aria-label="Edit gear">
              <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
            </button>
            <button type="button" onClick={toggleFavourite} aria-label="Favourite">
              <Star
                className={`h-4 w-4 ${item.is_favourite ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`}
              />
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {item.gear_type === "shoe" && (superShoe || traits.length > 0 || specBits.length > 0) && (
          <div className="flex flex-wrap items-center gap-1">
            {superShoe && (
              <Badge variant="outline" className="text-[10px] font-semibold" style={tintStyle("#a855f7")}>
                <Zap className="h-2.5 w-2.5 mr-1" /> Supershoe
              </Badge>
            )}
            {traits.map((t) => (
              <Badge key={t} variant="secondary" className="text-[10px] font-normal">
                {traitLabel(t)}
              </Badge>
            ))}
            {specBits.length > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums">{specBits.join(" · ")}</span>
            )}
          </div>
        )}
        {item.gear_type === "shoe" && !item.shoe_type && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[11px] text-muted-foreground underline hover:text-foreground block"
          >
            No shoe type set — say whether this is a spike, racer, trainer…
          </button>
        )}
        {item.gear_type === "shoe" && (
          <div className="flex flex-wrap gap-1">
            {purposes.length === 0 ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-[11px] text-muted-foreground underline hover:text-foreground"
              >
                No purpose set — add what this pair is used for
              </button>
            ) : (
              purposes.map((p) => (
                <Badge key={p} variant="outline" className="text-[10px] font-normal" style={tintStyle(purposeColour(p))}>
                  {purposeLabel(p)}
                </Badge>
              ))
            )}
          </div>
        )}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((r) => (
              <button key={r} type="button" onClick={() => setRating(r)} aria-label={`Rate ${r}`}>
                <Star
                  className={`h-3.5 w-3.5 ${(item.rating ?? 0) >= r ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`}
                />
              </button>
            ))}
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Gauge className="h-3 w-3" />
            {totalKm.toFixed(0)} km{usage?.count ? ` · ${usage.count} session${usage.count === 1 ? "" : "s"}` : ""}
          </div>
        </div>
        {pct != null && (
          <div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full ${pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-amber-500" : "bg-[var(--accent-red)]"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {totalKm.toFixed(0)} / {item.retirement_target_km} km
              {pct >= 100 && " · past target"}
            </div>
          </div>
        )}
        {open && (
          <div className="border-t pt-3 space-y-3">
            {item.description && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                  Designed for
                </div>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{item.description}</p>
              </div>
            )}
            {item.notes && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Notes</div>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{item.notes}</p>
              </div>
            )}
            <LinkedSessions gearId={item.id} athleteId={athleteId} />
            <LinkSessionPicker gearId={item.id} athleteId={athleteId} />
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
              </Button>
              <Button size="sm" variant="outline" onClick={toggleRetired}>
                {item.is_retired ? "Mark active" : "Mark retired"}
              </Button>
              <Button size="sm" variant="ghost" onClick={remove}>
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <GearEditDialog item={item} athleteId={athleteId} open={editing} onOpenChange={setEditing} />
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Linked sessions + link picker — the "from the Gear page" half of
// assignment (the other half, assigning from the session page itself,
// comes in a follow-up once the session detail file is re-uploaded).
// ----------------------------------------------------------------------------

function LinkedSessions({ gearId, athleteId }: { gearId: string; athleteId: string }) {
  const qc = useQueryClient();
  const { data: links } = useQuery({
    queryKey: ["gear-links", gearId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("session_gear")
        .select("id, session_id, sessions(session_date, title, total_distance_m)")
        .eq("gear_id", gearId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  async function unlink(id: string) {
    const { error } = await supabase.from("session_gear").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["gear-links", gearId] });
    qc.invalidateQueries({ queryKey: ["gear-usage", athleteId] });
  }

  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Linked sessions</div>
      {!links || links.length === 0 ? (
        <p className="text-xs text-muted-foreground">No sessions linked yet.</p>
      ) : (
        links.map((l) => (
          <div key={l.id} className="flex items-center justify-between gap-2 text-xs border border-border rounded px-2 py-1">
            <span className="truncate">
              {l.sessions?.session_date} · {l.sessions?.title ?? "Session"}
              {l.sessions?.total_distance_m ? ` · ${(Number(l.sessions.total_distance_m) / 1000).toFixed(1)}km` : ""}
            </span>
            <button type="button" onClick={() => unlink(l.id)} className="text-muted-foreground hover:text-destructive shrink-0" aria-label="Unlink">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))
      )}
    </div>
  );
}

function LinkSessionPicker({ gearId, athleteId }: { gearId: string; athleteId: string }) {
  const qc = useQueryClient();
  const [sessionId, setSessionId] = useState<string>("");

  const { data: candidates } = useQuery({
    queryKey: ["gear-link-candidates", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("id, session_date, title, time_of_day")
        .eq("athlete_id", athleteId)
        .order("session_date", { ascending: false })
        .order("time_of_day", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  async function link() {
    if (!sessionId) return;
    const { error } = await supabase
      .from("session_gear")
      .insert({ session_id: sessionId, gear_id: gearId, athlete_id: athleteId } as any);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Session linked");
    setSessionId("");
    qc.invalidateQueries({ queryKey: ["gear-links", gearId] });
    qc.invalidateQueries({ queryKey: ["gear-usage", athleteId] });
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={sessionId} onValueChange={setSessionId}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Link a session…" />
        </SelectTrigger>
        <SelectContent>
          {(candidates ?? []).map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.session_date} · {s.title ?? "Session"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" onClick={link} disabled={!sessionId}>
        <Link2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
