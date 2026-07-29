import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, CalendarRange, CopyPlus } from "lucide-react";

type SeasonType = "indoor" | "outdoor" | "cross_country";

type Season = {
  id: string;
  athlete_id: string;
  season_type: SeasonType;
  label: string;
  start_date: string;
  end_date: string;
};

const SEASON_TYPE_LABEL: Record<SeasonType, string> = {
  indoor: "Indoor",
  outdoor: "Outdoor",
  cross_country: "Cross Country",
};

const SEASON_TYPE_STYLES: Record<SeasonType, string> = {
  indoor: "bg-blue-100 text-blue-700 border-blue-200",
  outdoor: "bg-emerald-100 text-emerald-700 border-emerald-200",
  cross_country: "bg-amber-100 text-amber-700 border-amber-200",
};

// Shifts a YYYY-MM-DD string by whole years (positive or negative),
// preserving the exact month/day — used both by the "repeat across years"
// bulk-add and the per-row "Duplicate to next year" action. Shifting the
// actual entered dates (rather than recomputing from a month/day
// template) is what makes this correctly handle a season that crosses a
// calendar year boundary (e.g. a Southern Hemisphere Outdoor season
// running Oct–Mar) — the gap between start and end is preserved
// automatically, no separate cross-year-boundary logic needed, and it
// works identically whether shifting forward into future years or back
// into past ones.
function shiftYears(dateStr: string, years: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

// Detects a trailing year token already in the label — "2025", "2025/26",
// "2025-26", "2025/2026", "2025-2026" — and replaces just that part with
// the correct years for the shifted dates, preserving whatever separator
// and digit-length style was actually used ("Track 2025-2026" shifted
// back 4 years becomes "Track 2021-2022", not "Track 2025-2026" unchanged
// and not forced into a different format like "2021/22"). Used by both
// the "repeat across years" bulk-add and "Duplicate to next year" — a
// label with no year pattern at all still gets one appended (hyphen,
// full 4-digit years) rather than silently staying identical across every
// generated row, which was the actual bug being fixed here.
const TRAILING_YEAR_PATTERN = /\s+(\d{4})(?:([/-])(\d{2,4}))?\s*$/;

function deriveYearedLabel(rawLabel: string, startDate: string, endDate: string): string {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  const match = rawLabel.match(TRAILING_YEAR_PATTERN);

  if (match && match.index != null) {
    const base = rawLabel.slice(0, match.index).trimEnd();
    if (startYear === endYear) return `${base} ${startYear}`;
    const sep = match[2] ?? "-";
    const secondPartIsShort = (match[3]?.length ?? 4) === 2;
    const secondPart = secondPartIsShort ? String(endYear).slice(-2) : String(endYear);
    return `${base} ${startYear}${sep}${secondPart}`;
  }

  // No year pattern found in the typed label at all.
  return startYear === endYear ? `${rawLabel} ${startYear}` : `${rawLabel} ${startYear}-${endYear}`;
}

// Deliberately athlete-set date ranges rather than a fixed calendar —
// Southern and Northern hemisphere athletes have "summer"/"winter" (and
// therefore indoor/outdoor) on completely different months, and even
// within one athlete, indoor/outdoor/cross country seasons don't need
// to line up with each other or repeat identically year to year. These
// windows feed "Season Best" on the PBs list (src/lib/performance-pb.ts)
// — a result only gets a Season Best badge if its date actually falls
// inside one of these ranges.
export function AthleteSeasonsCard({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [seasonType, setSeasonType] = useState<SeasonType>("outdoor");
  const [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);

  // Repeat-across-years — off by default, so single-season add behaves
  // exactly as before. When on, `label` becomes a base name (no year) and
  // each generated row gets its own year suffix appended automatically.
  // Both directions are supported: yearsBack creates seasons BEFORE the
  // entered template (for backfilling history), yearsForward creates
  // seasons AFTER it (for setting up years ahead of time) — either or
  // both can be used together.
  const [repeatMode, setRepeatMode] = useState(false);
  const [yearsBack, setYearsBack] = useState(0);
  const [yearsForward, setYearsForward] = useState(3);

  const { data: seasons, isLoading } = useQuery({
    queryKey: ["athlete-seasons", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_seasons")
        .select("*")
        .eq("athlete_id", athleteId)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Season[];
    },
  });

  function invalidateAffected() {
    qc.invalidateQueries({ queryKey: ["athlete-seasons", athleteId] });
    // Season windows changing can shift which results are "Season Best"
    // across every list that shows PB badges for this athlete.
    qc.invalidateQueries({ queryKey: ["my-pbs", athleteId] });
    qc.invalidateQueries({ queryKey: ["pbs", athleteId] });
    qc.invalidateQueries({ queryKey: ["progression-performances", athleteId] });
    qc.invalidateQueries({ queryKey: ["races", athleteId] });
  }

  async function addSeason() {
    if (!label.trim() || !startDate || !endDate) {
      toast.error("Label and both dates are required");
      return;
    }
    if (endDate < startDate) {
      toast.error("End date can't be before the start date");
      return;
    }

    const back = repeatMode ? Math.max(0, Math.min(20, Math.round(yearsBack) || 0)) : 0;
    const forward = repeatMode ? Math.max(0, Math.min(20, Math.round(yearsForward) || 0)) : 0;

    if (repeatMode && back === 0 && forward === 0) {
      toast.error("Enter at least one year back or forward, or turn off repeat");
      return;
    }

    // Offsets run from -back through +forward, e.g. back=2, forward=3
    // creates 6 seasons total: 2 previous years, the entered template
    // year itself, and 3 future years.
    const offsets: number[] = [];
    for (let i = -back; i <= forward; i++) offsets.push(i);
    if (!repeatMode) offsets.length = 0, offsets.push(0);

    const rows = offsets.map((offset) => {
      const s = shiftYears(startDate, offset);
      const e = shiftYears(endDate, offset);
      return {
        athlete_id: athleteId,
        season_type: seasonType,
        label: repeatMode ? deriveYearedLabel(label.trim(), s, e) : label.trim(),
        start_date: s,
        end_date: e,
      };
    });

    setSaving(true);
    const { error } = await supabase.from("athlete_seasons").insert(rows);
    setSaving(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(rows.length > 1 ? `Added ${rows.length} seasons` : "Season added");
    setLabel("");
    setStartDate("");
    setEndDate("");
    setRepeatMode(false);
    setYearsBack(0);
    setYearsForward(3);
    setAdding(false);
    invalidateAffected();
  }

  // Quick per-row action for ongoing maintenance once years are already
  // set up — shifts this one season's dates (and label, best-effort) a
  // year forward and inserts it directly, without reopening the form or
  // retyping anything.
  async function duplicateToNextYear(s: Season) {
    const newStart = shiftYears(s.start_date, 1);
    const newEnd = shiftYears(s.end_date, 1);

    const { error } = await supabase.from("athlete_seasons").insert({
      athlete_id: athleteId,
      season_type: s.season_type,
      label: deriveYearedLabel(s.label, newStart, newEnd),
      start_date: newStart,
      end_date: newEnd,
    });

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Added next year's season — check the label and dates");
    invalidateAffected();
  }

  async function removeSeason(id: string) {
    const { error } = await supabase.from("athlete_seasons").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    invalidateAffected();
  }

  const totalToCreate = repeatMode
    ? Math.max(0, Math.min(20, Math.round(yearsBack) || 0)) + Math.max(0, Math.min(20, Math.round(yearsForward) || 0)) + 1
    : 1;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-[var(--accent-red)]" />
            Seasons
          </CardTitle>
          <CardDescription>
            Define indoor, outdoor, and cross country windows to unlock "Season Best" badges on results.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-4 w-4 mr-1" />
          {adding ? "Cancel" : "Add season"}
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {adding && (
          <div className="rounded-md border border-border p-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={seasonType} onValueChange={(v) => setSeasonType(v as SeasonType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="indoor">Indoor</SelectItem>
                    <SelectItem value="outdoor">Outdoor</SelectItem>
                    <SelectItem value="cross_country">Cross Country</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Label</Label>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Track 2025-2026"
                />
                {repeatMode && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Include the year like above and it'll be swapped for the right year on each one generated —
                    "Track 2025-2026" becomes "Track 2021-2022", "Track 2029-2030", etc.
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{repeatMode ? "Template start date" : "Start date"}</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">{repeatMode ? "Template end date" : "End date"}</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>

            <div className="rounded-md border border-dashed border-border p-2.5 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={repeatMode} onCheckedChange={(v) => setRepeatMode(!!v)} />
                <span className="text-xs font-medium">
                  Repeat this window across multiple years
                </span>
              </label>
              {repeatMode && (
                <div className="pl-6 space-y-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs whitespace-nowrap w-28">Years before</Label>
                    <Input
                      type="number"
                      min={0}
                      max={20}
                      value={yearsBack}
                      onChange={(e) => setYearsBack(Number(e.target.value))}
                      className="w-20"
                    />
                    <span className="text-xs text-muted-foreground">additional past years</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs whitespace-nowrap w-28">Years after</Label>
                    <Input
                      type="number"
                      min={0}
                      max={20}
                      value={yearsForward}
                      onChange={(e) => setYearsForward(Number(e.target.value))}
                      className="w-20"
                    />
                    <span className="text-xs text-muted-foreground">additional future years</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Same month/day span every year, shifted — e.g. an Oct–Mar template stays Oct–Mar each year, just
                    earlier or later. The template dates above count as one of the years created.
                  </p>
                </div>
              )}
            </div>

            <Button size="sm" onClick={addSeason} disabled={saving}>
              {saving ? "Saving…" : totalToCreate > 1 ? `Save ${totalToCreate} seasons` : "Save season"}
            </Button>
          </div>
        )}

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!isLoading && (seasons ?? []).length === 0 && !adding && (
          <p className="text-sm text-muted-foreground">
            No seasons set yet — add one to start seeing Season Best badges on results.
          </p>
        )}

        <div className="divide-y">
          {(seasons ?? []).map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant="outline" className={SEASON_TYPE_STYLES[s.season_type]}>
                  {SEASON_TYPE_LABEL[s.season_type]}
                </Badge>
                <span className="font-medium truncate">{s.label}</span>
                <span className="text-muted-foreground text-xs whitespace-nowrap">
                  {s.start_date} – {s.end_date}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  title="Duplicate to next year"
                  onClick={() => duplicateToNextYear(s)}
                >
                  <CopyPlus className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => removeSeason(s.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
