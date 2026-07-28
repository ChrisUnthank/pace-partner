import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Flag } from "lucide-react";

// Event Suitability — scoped to the 8 fixed distances only. The doc's
// list also includes Cross Country, Road Racing, and Mountain Running,
// but none of those are fixed distances and the app has no terrain/
// elevation data source at all — same call as dropping Strength/Climbing
// Ability from the DNA ratings. Left out entirely rather than showing a
// permanent "insufficient data" card for something that can never fill
// in.
//
// Methodology: each distance has a commonly-cited approximate aerobic vs.
// anaerobic energy-system contribution from exercise physiology (e.g.
// Spencer & Gastin) — 400m leans heavily anaerobic, a marathon is almost
// entirely aerobic. Suitability here is just "how close is this athlete's
// own computed anaerobic_pct (already in athlete_physio_profile) to that
// event's typical demand" — closer match scores higher. This is a real,
// citable model, but it's a simplification: it doesn't yet weight speed
// reserve, terrain, or race craft, so the UI says so rather than implying
// more precision than it has.

const EVENT_DEMAND: Array<{ label: string; m: number; anaerobicPct: number }> = [
  { label: "400m", m: 400, anaerobicPct: 70 },
  { label: "800m", m: 800, anaerobicPct: 40 },
  { label: "1500m", m: 1500, anaerobicPct: 25 },
  { label: "3000m", m: 3000, anaerobicPct: 15 },
  { label: "5000m", m: 5000, anaerobicPct: 10 },
  { label: "10K", m: 10000, anaerobicPct: 5 },
  { label: "Half Marathon", m: 21097, anaerobicPct: 2 },
  { label: "Marathon", m: 42195, anaerobicPct: 1 },
];

function bucketFromScore(score: number): "Low" | "Developing" | "Good" | "Excellent" | "Elite" {
  if (score < 20) return "Low";
  if (score < 40) return "Developing";
  if (score < 65) return "Good";
  if (score < 85) return "Excellent";
  return "Elite";
}

const BUCKET_STYLES: Record<string, string> = {
  Low: "bg-rose-100 text-rose-700 border-rose-200",
  Developing: "bg-amber-100 text-amber-700 border-amber-200",
  Good: "bg-sky-100 text-sky-700 border-sky-200",
  Excellent: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Elite: "bg-violet-100 text-violet-700 border-violet-200",
};

export function EventSuitabilityCard({ athleteId }: { athleteId: string }) {
  // Same query key every other DNA-tab card uses for this table —
  // dedupes the fetch.
  const { data: physio, isLoading } = useQuery({
    queryKey: ["physio", athleteId],
    queryFn: async () => {
      const { data } = await supabase.from("athlete_physio_profile").select("*").eq("athlete_id", athleteId).maybeSingle();
      return data;
    },
  });

  const rows = useMemo(() => {
    if (!physio || physio.status !== "ok" || physio.anaerobic_pct == null) return [];
    const athleteAnaerobic = Number(physio.anaerobic_pct);
    return EVENT_DEMAND.map((event) => {
      const gap = Math.abs(athleteAnaerobic - event.anaerobicPct);
      const score = Math.max(0, Math.min(100, 100 - gap));
      return { ...event, score, bucket: bucketFromScore(score) };
    });
  }, [physio]);

  const best = useMemo(() => {
    if (rows.length === 0) return null;
    return rows.reduce((a, b) => (b.score > a.score ? b : a));
  }, [rows]);

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Flag className="h-4 w-4 text-[var(--accent-red)]" />
          Event Suitability
        </CardTitle>
        <CardDescription>
          Based on how closely this athlete's own aerobic/anaerobic split matches each distance's typical
          physiological demand — a simplified model, doesn't yet weight speed reserve or terrain. Recalculates as new
          PBs are logged.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Log PBs at two or more distances (ideally 1500m and 5000m) to generate event suitability.
          </p>
        ) : (
          <>
            {best && (
              <p className="text-sm mb-3">
                Best physiological fit: <span className="font-medium">{best.label}</span>
              </p>
            )}
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {rows.map((r) => (
                <div key={r.label} className="border rounded-lg p-2.5 text-center">
                  <div className="text-xs text-muted-foreground">{r.label}</div>
                  <div className="text-lg font-bold tabular-nums mt-0.5">{Math.round(r.score)}</div>
                  <Badge variant="outline" className={`text-[10px] mt-1 ${BUCKET_STYLES[r.bucket]}`}>
                    {r.bucket}
                  </Badge>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
