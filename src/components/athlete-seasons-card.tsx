import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, CalendarRange } from "lucide-react";

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

    setSaving(true);
    const { error } = await supabase.from("athlete_seasons").insert({
      athlete_id: athleteId,
      season_type: seasonType,
      label: label.trim(),
      start_date: startDate,
      end_date: endDate,
    });
    setSaving(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Season added");
    setLabel("");
    setStartDate("");
    setEndDate("");
    setAdding(false);
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
                  placeholder="e.g. Outdoor 2025/26"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Start date</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">End date</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <Button size="sm" onClick={addSeason} disabled={saving}>
              {saving ? "Saving…" : "Save season"}
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
              <Button variant="ghost" size="sm" onClick={() => removeSeason(s.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
