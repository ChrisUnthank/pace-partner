import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMyAthlete } from "@/lib/use-auth";
import { uploadAndParseSessionFile, submitCheckout } from "@/lib/session-files.functions";
import { todayISO } from "@/lib/format";
import { toast } from "sonner";
import { Upload, Loader2, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/checkout")({
  component: Checkout,
});

function Checkout() {
  const { data: athlete } = useMyAthlete();
  const today = todayISO();
  const upload = useServerFn(uploadAndParseSessionFile);
  const submit = useServerFn(submitCheckout);

  const { data: sessions = [], refetch } = useQuery({
    queryKey: ["checkout-sessions", athlete?.id, today],
    enabled: !!athlete?.id,
    queryFn: async () => {
      const { data } = await supabase.from("sessions").select("*").eq("athlete_id", athlete!.id).eq("session_date", today);
      return data ?? [];
    },
  });

  const [feelByS, setFeel] = useState<Record<string, number>>({});
  const [wentWell, setWentWell] = useState<Record<string, string>>({});
  const [wasHard, setWasHard] = useState<Record<string, string>>({});
  const [niggles, setNiggles] = useState<Record<string, string>>({});
  const [endNote, setEndNote] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);

  async function handleFile(sessionId: string | null, file: File) {
    if (!athlete) return;
    setUploading(file.name);
    try {
      const buf = await file.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const kind = file.name.toLowerCase().endsWith(".fit") ? "fit" : "gpx";
      const res = await upload({ data: { athleteId: athlete.id, sessionId: sessionId ?? undefined, filename: file.name, kind, fileBase64: b64 } });
      toast.success(`${file.name}: ${res.points} points`);
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  const submitMut = useMutation({
    mutationFn: async () => {
      const insights = sessions
        .filter((s: any) => feelByS[s.id] != null)
        .map((s: any) => ({ sessionId: s.id, feel: feelByS[s.id], wentWell: wentWell[s.id], wasDifficult: wasHard[s.id], niggles: niggles[s.id] }));
      return submit({ data: { athleteId: athlete!.id, sessionInsights: insights, endOfDayNote: endNote || undefined } });
    },
    onSuccess: () => { toast.success("Checkout submitted"); refetch(); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  if (!athlete) return <AppShell><p>Loading…</p></AppShell>;

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold">Daily checkout</h1>
          <p className="text-sm text-muted-foreground">Upload your sessions, reflect on how each one felt, and add an end-of-day note.</p>
        </div>

        {sessions.length === 0 ? (
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="text-sm text-muted-foreground">No planned sessions for today. Rest day?</p>
              <Textarea placeholder="End-of-day note (optional)" value={endNote} onChange={(e) => setEndNote(e.target.value)} />
              <Button onClick={() => submitMut.mutate()} disabled={submitMut.isPending}>
                Submit checkout
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {sessions.map((s: any) => (
              <Card key={s.id}>
                <CardHeader>
                  <CardTitle className="text-base">{s.title}</CardTitle>
                  <CardDescription>{s.completed_at ? "Completed" : "Not yet completed"}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <label className="text-xs font-medium uppercase text-muted-foreground">Upload .fit / .gpx</label>
                    <div className="mt-1 flex items-center gap-2">
                      <Input type="file" accept=".fit,.gpx" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(s.id, f); }} />
                      {uploading === s.id && <Loader2 className="h-4 w-4 animate-spin" />}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium uppercase text-muted-foreground">How did it feel? (1–10)</label>
                    <div className="flex gap-1 mt-1">
                      {[1,2,3,4,5,6,7,8,9,10].map((n) => (
                        <Button key={n} size="sm" variant={feelByS[s.id] === n ? "default" : "outline"} onClick={() => setFeel((p) => ({ ...p, [s.id]: n }))}>{n}</Button>
                      ))}
                    </div>
                  </div>
                  <Textarea placeholder="What went well?" value={wentWell[s.id] ?? ""} onChange={(e) => setWentWell((p) => ({ ...p, [s.id]: e.target.value }))} />
                  <Textarea placeholder="What was difficult?" value={wasHard[s.id] ?? ""} onChange={(e) => setWasHard((p) => ({ ...p, [s.id]: e.target.value }))} />
                  <Textarea placeholder="Any niggles / pain?" value={niggles[s.id] ?? ""} onChange={(e) => setNiggles((p) => ({ ...p, [s.id]: e.target.value }))} />
                </CardContent>
              </Card>
            ))}
            <Card>
              <CardHeader><CardTitle className="text-base">End of day</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Textarea placeholder="Overall reflection (optional)" value={endNote} onChange={(e) => setEndNote(e.target.value)} />
                <Button onClick={() => submitMut.mutate()} disabled={submitMut.isPending}>
                  {submitMut.isSuccess ? <><CheckCircle2 className="h-4 w-4 mr-1" /> Submitted</> : "Submit checkout"}
                </Button>
              </CardContent>
            </Card>
          </>
        )}

        <p className="text-xs text-muted-foreground"><Link to="/app/today" className="underline">← Back to today</Link></p>
      </div>
    </AppShell>
  );
}