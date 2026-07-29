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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { todayISO } from "@/lib/format";
import { toast } from "sonner";
import { Star, Trash2, ChevronDown, ChevronUp, Link2, Footprints, Bike as BikeIcon, Activity, Package } from "lucide-react";
import { BucketTabStrip, LOCKER_TABS } from "@/components/bucket-tab-strip";

export const Route = createFileRoute("/_authenticated/app/gear")({
  component: GearPage,
});

const SHOE_CATEGORIES = ["track", "road", "everyday", "off_road"] as const;

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
              Track shoes, bike, and other kit — rate them, mark favourites, and see how far each one's actually gone.
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
  const [gearType, setGearType] = useState<string>("shoe");
  const [shoeCategory, setShoeCategory] = useState<string>("everyday");
  const [isSpike, setIsSpike] = useState(false);
  const [brand, setBrand] = useState<string>(BRANDS_BY_TYPE.shoe[0]);
  const [customBrand, setCustomBrand] = useState("");
  const [model, setModel] = useState("");
  const [nickname, setNickname] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [retirementTarget, setRetirementTarget] = useState("");
  const [notes, setNotes] = useState("");

  function changeType(t: string) {
    setGearType(t);
    setBrand(BRANDS_BY_TYPE[t][0]);
    setCustomBrand("");
  }

  async function save() {
    if (!model.trim()) {
      toast.error("Model is required");
      return;
    }
    const finalBrand = brand === "Other" ? customBrand.trim() || "Other" : brand;
    const payload = {
      athlete_id: athleteId,
      gear_type: gearType,
      shoe_category: gearType === "shoe" ? shoeCategory : null,
      is_spike: gearType === "shoe" ? isSpike : false,
      brand: finalBrand,
      model: model.trim(),
      nickname: nickname || null,
      purchase_date: purchaseDate || null,
      retirement_target_km: retirementTarget === "" ? null : Number(retirementTarget),
      notes: notes || null,
    };
    const { error } = await supabase.from("gear_items").insert(payload as any);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Gear added");
    setModel("");
    setNickname("");
    setPurchaseDate("");
    setRetirementTarget("");
    setNotes("");
    setCustomBrand("");
    qc.invalidateQueries({ queryKey: ["gear-list", athleteId] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add gear</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={gearType} onValueChange={changeType}>
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
          {gearType === "shoe" && (
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={shoeCategory} onValueChange={setShoeCategory}>
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
            <Select value={brand} onValueChange={setBrand}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BRANDS_BY_TYPE[gearType].map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {brand === "Other" && (
            <div>
              <Label className="text-xs">Brand name</Label>
              <Input value={customBrand} onChange={(e) => setCustomBrand(e.target.value)} placeholder="Brand" />
            </div>
          )}
          <div>
            <Label className="text-xs">Model</Label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. Vaporfly 3" />
          </div>
          <div>
            <Label className="text-xs">Nickname (optional)</Label>
            <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="e.g. Race day" />
          </div>
          <div>
            <Label className="text-xs">Purchase date (optional)</Label>
            <Input type="date" value={purchaseDate} max={todayISO()} onChange={(e) => setPurchaseDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Retirement target — km (optional)</Label>
            <Input
              type="number"
              value={retirementTarget}
              onChange={(e) => setRetirementTarget(e.target.value)}
              placeholder="600"
            />
          </div>
          {gearType === "shoe" && (
            <div className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                id="spike"
                checked={isSpike}
                onChange={(e) => setIsSpike(e.target.checked)}
                className="h-4 w-4"
              />
              <Label htmlFor="spike" className="text-xs cursor-pointer">
                Spikes
              </Label>
            </div>
          )}
        </div>
        <Textarea placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Button onClick={save} className="w-full">
          Save gear
        </Button>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// List — one card per item, usage computed from linked sessions
// ----------------------------------------------------------------------------

function GearList({ athleteId }: { athleteId: string }) {
  const { data: gearItems } = useQuery({
    queryKey: ["gear-list", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gear_items")
        .select("*")
        .eq("athlete_id", athleteId)
        .order("is_favourite", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // One row per session a gear item is linked to, carrying that session's
  // distance — summed client-side per gear_id below rather than via a
  // stored running total, so usage is always accurate even if a linked
  // session's distance is later corrected.
  const { data: usageRows } = useQuery({
    queryKey: ["gear-usage", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("session_gear")
        .select("gear_id, sessions(total_distance_m)")
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

  if (!gearItems || gearItems.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground text-center">No gear added yet.</CardContent>
      </Card>
    );
  }

  const active = gearItems.filter((g) => !g.is_retired);
  const retired = gearItems.filter((g) => g.is_retired);

  return (
    <div className="space-y-3">
      {active.map((g) => (
        <GearCard key={g.id} item={g} usage={usageByGear.get(g.id)} athleteId={athleteId} />
      ))}
      {retired.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-4">Retired</div>
          <div className="space-y-2">
            {retired.map((g) => (
              <GearCard key={g.id} item={g} usage={usageByGear.get(g.id)} athleteId={athleteId} />
            ))}
          </div>
        </div>
      )}
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
  const Icon = TYPE_ICON[item.gear_type] ?? Package;
  const totalKm = usage ? usage.totalM / 1000 : 0;
  const pct = item.retirement_target_km ? Math.min(100, (totalKm / Number(item.retirement_target_km)) * 100) : null;

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
            <button type="button" onClick={toggleFavourite} aria-label="Favourite">
              <Star className={`h-4 w-4 ${item.is_favourite ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
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
            <LinkedSessions gearId={item.id} athleteId={athleteId} />
            <LinkSessionPicker gearId={item.id} athleteId={athleteId} />
            <div className="flex gap-2">
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
        .select("id, session_date, title")
        .eq("athlete_id", athleteId)
        .order("session_date", { ascending: false })
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
