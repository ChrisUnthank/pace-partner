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
  Search,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Link2,
  Footprints,
  Bike as BikeIcon,
  Activity,
  Package,
  Pencil,
} from "lucide-react";
import { BucketTabStrip, LOCKER_TABS } from "@/components/bucket-tab-strip";
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip } from "recharts";

export const Route = createFileRoute("/_authenticated/app/gear")({
  component: GearPage,
});

const SHOE_CATEGORIES = ["track", "road", "everyday", "off_road"] as const;

// What a piece of gear is actually FOR, as opposed to what kind of thing it
// is. shoe_category (track/road/everyday/off_road) answers "what sort of
// shoe"; this answers "which sessions does it come out for", which is a
// different question and rarely has a single answer — a pair of road
// threshold shoes might also cover tempo runs and long-run pickups.
//
// Stored as text[] in gear_items.used_for (see
// supabase/migrations/20260811090000_gear-used-for.sql). Values are stable
// snake_case keys; the labels below are the only thing anyone sees, so a
// label can be reworded without touching stored data.
//
// Grouped purely for the picker's readability — the groups aren't stored
// and carry no meaning beyond layout.
const PURPOSE_GROUPS: { group: string; options: { value: string; label: string }[] }[] = [
  {
    group: "Everyday running",
    options: [
      { value: "easy_runs", label: "Easy runs" },
      { value: "long_runs", label: "Long runs" },
      { value: "recovery_runs", label: "Recovery runs" },
      { value: "warmup_cooldown", label: "Warm up / cool down" },
    ],
  },
  {
    group: "Continuous efforts",
    options: [
      { value: "tempo_runs", label: "Tempo runs" },
      { value: "threshold_runs", label: "Threshold runs" },
      { value: "progression_runs", label: "Progression runs" },
    ],
  },
  {
    group: "Structured sessions",
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
    group: "Racing",
    options: [
      { value: "race_track", label: "Racing (track)" },
      { value: "race_road", label: "Racing (road)" },
      { value: "race_xc", label: "Racing (cross country)" },
    ],
  },
  {
    group: "Other",
    options: [
      { value: "gym", label: "Gym" },
      { value: "treadmill", label: "Treadmill" },
      { value: "trail_offroad", label: "Trail / off-road" },
    ],
  },
];

const ALL_PURPOSES = PURPOSE_GROUPS.flatMap((g) => g.options);
const PURPOSE_LABEL: Record<string, string> = Object.fromEntries(ALL_PURPOSES.map((o) => [o.value, o.label]));

function purposeLabel(v: string): string {
  // Falls back to the raw value rather than hiding it, so a purpose removed
  // from the vocabulary later still shows something rather than vanishing
  // silently off a gear card.
  return PURPOSE_LABEL[v] ?? v.replace(/_/g, " ");
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

// ----------------------------------------------------------------------------
// Shared form shape — used by BOTH "Add gear" and the edit dialog, so the two
// can't drift apart the way they would as two hand-maintained copies.
// ----------------------------------------------------------------------------

type GearDraft = {
  gear_type: string;
  shoe_category: string;
  is_spike: boolean;
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
    shoe_category: "everyday",
    is_spike: false,
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
    shoe_category: item.shoe_category ?? "everyday",
    is_spike: !!item.is_spike,
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
  return {
    athlete_id: athleteId,
    gear_type: d.gear_type,
    shoe_category: d.gear_type === "shoe" ? d.shoe_category : null,
    is_spike: d.gear_type === "shoe" ? d.is_spike : false,
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
// Purpose picker — multi-select checkboxes, grouped.
// ----------------------------------------------------------------------------

function PurposePicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Label className="text-xs">Used for</Label>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {value.length} selected
          </span>
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
      <div className="rounded-md border max-h-[260px] overflow-y-auto brand-scrollbar divide-y">
        {PURPOSE_GROUPS.map((g) => (
          <div key={g.group} className="p-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
              {g.group}
            </div>
            <div className="grid sm:grid-cols-2 gap-x-3 gap-y-1.5">
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
      <p className="text-[11px] text-muted-foreground leading-snug">
        Tick everything the shoe genuinely comes out for — most shoes cover more than one. This drives which shoes get
        suggested when logging a session, and keeps mechanics comparisons like-for-like.
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Shared field set
// ----------------------------------------------------------------------------

function GearFormFields({
  draft,
  setDraft,
}: {
  draft: GearDraft;
  setDraft: (next: GearDraft) => void;
}) {
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

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
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
          <div>
            <Label className="text-xs">Category</Label>
            <Select value={draft.shoe_category} onValueChange={(v) => set("shoe_category", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHOE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c} className="capitalize">
                    {c.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
            <Input
              value={draft.customBrand}
              onChange={(e) => set("customBrand", e.target.value)}
              placeholder="Brand"
            />
          </div>
        )}
        <div>
          <Label className="text-xs">Model</Label>
          <Input value={draft.model} onChange={(e) => set("model", e.target.value)} placeholder="e.g. Vaporfly 3" />
        </div>
        <div>
          <Label className="text-xs">Nickname (optional)</Label>
          <Input
            value={draft.nickname}
            onChange={(e) => set("nickname", e.target.value)}
            placeholder="e.g. Race day"
          />
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
          <div className="flex items-center gap-2 pt-5">
            <Checkbox
              id={`spike-${draft.gear_type}`}
              checked={draft.is_spike}
              onCheckedChange={(v) => set("is_spike", v === true)}
            />
            <Label htmlFor={`spike-${draft.gear_type}`} className="text-xs cursor-pointer">
              Spikes
            </Label>
          </div>
        )}
      </div>

      {draft.gear_type === "shoe" && <PurposePicker value={draft.used_for} onChange={(v) => set("used_for", v)} />}

      <div>
        <Label className="text-xs">Notes</Label>
        <Textarea
          className="mt-1"
          placeholder="Notes"
          value={draft.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </div>
    </div>
  );
}

function GearPage() {
  const { data: athlete, isLoading } = useMyAthlete();

  if (isLoading) return <AppShell fullWidth><p>Loading…</p></AppShell>;
  if (!athlete)
    return (
      <AppShell fullWidth>
        <p className="text-sm">
          No athlete profile linked. Visit <Link to="/app/account" className="underline">Account</Link>.
        </p>
      </AppShell>
    );

  return (
    <AppShell fullWidth>
      <div className="space-y-6 max-w-3xl">
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
              Track shoes, bike, and other kit — say what each pair is for, rate them, mark favourites, and see how far
              each one's actually gone.
            </p>
          </div>
        </div>
        <BucketTabStrip items={LOCKER_TABS} active="/app/gear" />
        <NewGearForm athleteId={athlete.id} />
        <GearList athleteId={athlete.id} />
      </div>
    </AppShell>
  );
}

// ----------------------------------------------------------------------------
// Add gear
// ----------------------------------------------------------------------------

function NewGearForm({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<GearDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);

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
    setDraft(emptyDraft());
    qc.invalidateQueries({ queryKey: ["gear-list", athleteId] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add gear</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <GearFormFields draft={draft} setDraft={setDraft} />
        <Button onClick={save} className="w-full" disabled={saving}>
          {saving ? "Saving…" : "Save gear"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Edit gear — everything the add form captures, reopened against an existing
// item. Previously the only editable fields anywhere were rating, favourite
// and retired, so a typo'd model or a wrong retirement target meant deleting
// the item and losing its linked-session history with it.
// ----------------------------------------------------------------------------

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
      <DialogContent className="max-w-2xl">
        <DialogHeader className="min-w-0">
          <DialogTitle>Edit gear</DialogTitle>
          <DialogDescription>
            Changes here don't affect linked sessions or accumulated distance.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-y-auto brand-scrollbar pr-1">
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
// List — one card per item, usage computed from linked sessions
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// Locker overview — headline numbers, breakdowns, and things needing attention.
//
// Covers ALL gear types, not just shoes: the by-type block is the top-level
// view, and the category/purpose breakdowns below it are shoe-specific
// simply because those two fields only exist on shoes.
// ----------------------------------------------------------------------------

const TYPE_LABEL: Record<string, string> = {
  shoe: "Shoes",
  bike: "Bikes",
  treadmill: "Treadmills",
  other: "Other gear",
};

const CATEGORY_LABEL: Record<string, string> = {
  track: "Track",
  road: "Road",
  everyday: "Everyday",
  off_road: "Off-road",
};

const CHART_COLOURS = ["#ef4444", "#f97316", "#3b82f6", "#10b981", "#8b5cf6", "#eab308", "#14b8a6"];

function km(m: number): number {
  return m / 1000;
}

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
    const active = items.filter((g) => !g.is_retired);
    const retired = items.filter((g) => g.is_retired);

    // By gear type — every type, shoes included.
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

    // By shoe category — distance is meaningful here because a shoe has
    // exactly one category, so nothing is counted twice.
    const byCategory = new Map<string, { count: number; totalM: number }>();
    for (const g of shoes) {
      const c = g.shoe_category ?? "unset";
      const cur = byCategory.get(c) ?? { count: 0, totalM: 0 };
      cur.count += 1;
      cur.totalM += usageByGear.get(g.id)?.totalM ?? 0;
      byCategory.set(c, cur);
    }

    // By purpose — COUNT of shoes only, deliberately not distance. A shoe
    // tagged for four purposes would contribute its full mileage to all
    // four, which would produce a chart whose bars sum to several times the
    // real distance. Counting shoes is the honest version of this question.
    const byPurpose = new Map<string, number>();
    for (const g of shoes) {
      for (const p of (g.used_for ?? []) as string[]) byPurpose.set(p, (byPurpose.get(p) ?? 0) + 1);
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

    const pastTarget = withTarget.filter((x) => x.pct >= 100).sort((a, b) => b.pct - a.pct);
    const nearingTarget = withTarget.filter((x) => x.pct >= 80 && x.pct < 100).sort((a, b) => b.pct - a.pct);
    const noPurpose = shoes.filter((g) => !g.is_retired && ((g.used_for ?? []) as string[]).length === 0);
    const neverUsed = items.filter((g) => !g.is_retired && (usageByGear.get(g.id)?.count ?? 0) === 0);

    const mostUsed = items
      .map((g) => ({ g, totalM: usageByGear.get(g.id)?.totalM ?? 0 }))
      .sort((a, b) => b.totalM - a.totalM)
      .filter((x) => x.totalM > 0)
      .slice(0, 3);

    return {
      total: items.length,
      active: active.length,
      retired: retired.length,
      byType: Array.from(byType.entries()).sort((a, b) => b[1].totalM - a[1].totalM),
      byCategory: Array.from(byCategory.entries()).sort((a, b) => b[1].totalM - a[1].totalM),
      byPurpose: Array.from(byPurpose.entries()).sort((a, b) => b[1] - a[1]),
      pastTarget,
      nearingTarget,
      noPurpose,
      neverUsed,
      mostUsed,
      shoeCount: shoes.length,
    };
  }, [items, usageByGear]);

  const categoryChart = stats.byCategory.map(([c, v], i) => ({
    name: CATEGORY_LABEL[c] ?? (c === "unset" ? "Not set" : c),
    km: Math.round(km(v.totalM)),
    count: v.count,
    fill: CHART_COLOURS[i % CHART_COLOURS.length],
  }));

  const purposeChart = stats.byPurpose.map(([p, n], i) => ({
    name: purposeLabel(p),
    shoes: n,
    fill: CHART_COLOURS[i % CHART_COLOURS.length],
  }));

  // If the same session is tagged to more than one item, every one of them is
  // credited the session's full distance — so the per-gear totals can add up
  // to more than the athlete has actually covered. Surfaced rather than
  // quietly papered over, because it also inflates retirement progress.
  const overlapM = Math.max(0, summedGearM - distinctSessionM);
  const hasOverlap = distinctSessionM > 0 && overlapM / distinctSessionM > 0.02;

  const attention =
    stats.pastTarget.length + stats.nearingTarget.length + stats.noPurpose.length + stats.neverUsed.length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Locker overview</CardTitle>
        <CardDescription>Everything in the locker at a glance — all gear types, not just shoes.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Headline tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="border rounded-lg p-3">
            <div className="text-2xl font-bold tabular-nums">{stats.total}</div>
            <div className="text-[11px] text-muted-foreground">
              items{stats.retired > 0 ? ` · ${stats.retired} retired` : ""}
            </div>
          </div>
          <div className="border rounded-lg p-3">
            <div className="text-2xl font-bold tabular-nums">{stats.active}</div>
            <div className="text-[11px] text-muted-foreground">in rotation</div>
          </div>
          <div className="border rounded-lg p-3">
            <div className="text-2xl font-bold tabular-nums">{Math.round(km(distinctSessionM)).toLocaleString()}</div>
            <div className="text-[11px] text-muted-foreground">km across tagged sessions</div>
          </div>
          <div className="border rounded-lg p-3">
            <div className="text-2xl font-bold tabular-nums">
              {stats.shoeCount > 0 ? Math.round(km(summedGearM) / Math.max(1, stats.shoeCount)) : 0}
            </div>
            <div className="text-[11px] text-muted-foreground">avg km per shoe</div>
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

        {/* By gear type */}
        {stats.byType.length > 0 && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
              By gear type
            </div>
            <div className="space-y-1.5">
              {stats.byType.map(([t, v]) => {
                const share = summedGearM > 0 ? (v.totalM / summedGearM) * 100 : 0;
                return (
                  <div key={t} className="flex items-center gap-3 text-sm">
                    <span className="w-28 shrink-0 truncate">{TYPE_LABEL[t] ?? t}</span>
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-[var(--accent-red)]" style={{ width: `${share}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-32 text-right">
                      {v.count} item{v.count === 1 ? "" : "s"} · {Math.round(km(v.totalM)).toLocaleString()} km
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Shoe charts */}
        {(categoryChart.length > 0 || purposeChart.length > 0) && (
          <div className="grid lg:grid-cols-2 gap-4">
            {categoryChart.length > 0 && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  Shoes by category — km
                </div>
                <div style={{ height: Math.max(110, categoryChart.length * 34) }} className="w-full">
                  <ResponsiveContainer>
                    <BarChart data={categoryChart} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={78} />
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
                        {categoryChart.map((d) => (
                          <Cell key={d.name} fill={d.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {purposeChart.length > 0 && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  Shoes by purpose — how many pairs cover each
                </div>
                <div style={{ height: Math.max(110, purposeChart.length * 26) }} className="w-full">
                  <ResponsiveContainer>
                    <BarChart data={purposeChart} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                      <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={140} />
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
                        {purposeChart.map((d) => (
                          <Cell key={d.name} fill={d.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
                  Counts pairs, not distance — a shoe tagged for four purposes would otherwise contribute its full
                  mileage to all four and the bars would add up to several times the real total.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Most used */}
        {stats.mostUsed.length > 0 && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Most used</div>
            <div className="space-y-1">
              {stats.mostUsed.map(({ g, totalM }) => (
                <div key={g.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{g.nickname || `${g.brand} ${g.model}`}</span>
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                    {Math.round(km(totalM)).toLocaleString()} km
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Attention */}
        {attention > 0 && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Worth a look
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
                    {x.g.nickname || `${x.g.brand} ${x.g.model}`} is at {Math.round(x.pct)}% of its {x.target} km target
                  </span>
                </div>
              ))}
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
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Collapsible group — one per gear type, plus one for retired items.
// ----------------------------------------------------------------------------

function GearGroup({
  title,
  items,
  usageByGear,
  athleteId,
  defaultOpen,
}: {
  title: string;
  items: any[];
  usageByGear: Map<string, { totalM: number; count: number }>;
  athleteId: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (items.length === 0) return null;

  const totalM = items.reduce((sum, g) => sum + (usageByGear.get(g.id)?.totalM ?? 0), 0);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-left px-1 py-1.5 hover:bg-accent/30 rounded transition-colors"
      >
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        <Badge variant="outline" className="text-[10px]">
          {items.length}
        </Badge>
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums shrink-0">
          {Math.round(km(totalM)).toLocaleString()} km
        </span>
      </button>
      {open && (
        <div className="space-y-2">
          {items.map((g) => (
            <GearCard key={g.id} item={g} usage={usageByGear.get(g.id)} athleteId={athleteId} />
          ))}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// List — summary, filters, then collapsible groups
// ----------------------------------------------------------------------------

function GearList({ athleteId }: { athleteId: string }) {
  const [purposeFilter, setPurposeFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
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

  const filtered = useMemo(() => {
    let out = gearItems ?? [];
    if (typeFilter !== "all") out = out.filter((g) => (g.gear_type ?? "other") === typeFilter);
    if (purposeFilter === "__none__") {
      out = out.filter((g) => g.gear_type === "shoe" && ((g.used_for ?? []) as string[]).length === 0);
    } else if (purposeFilter !== "all") {
      out = out.filter((g) => ((g.used_for ?? []) as string[]).includes(purposeFilter));
    }
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((g) =>
        `${g.brand ?? ""} ${g.model ?? ""} ${g.nickname ?? ""}`.toLowerCase().includes(q),
      );
    }
    return out;
  }, [gearItems, purposeFilter, typeFilter, search]);

  if (!gearItems || gearItems.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground text-center">No gear added yet.</CardContent>
      </Card>
    );
  }

  const activeFiltered = filtered.filter((g) => !g.is_retired);
  const retiredFiltered = filtered.filter((g) => g.is_retired);
  const filtersOn = typeFilter !== "all" || purposeFilter !== "all" || search.trim() !== "";

  // Groups start open when the locker is small enough to scan, and closed
  // once it isn't — but a filter or search always opens them, since the
  // person has already narrowed to what they're looking for.
  const autoOpen = filtersOn || activeFiltered.length <= 8;

  return (
    <div className="space-y-4">
      <GearSummary
        items={gearItems}
        usageByGear={usageByGear}
        distinctSessionM={distinctSessionM}
        summedGearM={summedGearM}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Gear</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-3 gap-2">
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
                  items={activeFiltered.filter((g) => (g.gear_type ?? "other") === t)}
                  usageByGear={usageByGear}
                  athleteId={athleteId}
                  defaultOpen={autoOpen}
                />
              ))}
              <GearGroup
                title="Retired"
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
  );
}

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
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <CardTitle className="text-base truncate">{item.nickname || `${item.brand} ${item.model}`}</CardTitle>
              <CardDescription className="truncate">
                {item.brand} {item.model}
                {item.shoe_category && ` · ${String(item.shoe_category).replace("_", " ")}`}
                {item.is_spike && " · spikes"}
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
              <Star className={`h-4 w-4 ${item.is_favourite ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
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
                <Badge key={p} variant="secondary" className="text-[10px] font-normal">
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
                <Star className={`h-3.5 w-3.5 ${(item.rating ?? 0) >= r ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
              </button>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">
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
            {item.notes && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{item.notes}</p>}
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
