import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { uploadAndParseSessionFile } from "@/lib/session-files.functions";
import { Loader2, Plus, Trash2, Upload, AlertTriangle, CheckCircle2 } from "lucide-react";
import { todayISO } from "@/lib/format";
import { toast } from "sonner";
import { invalidateSession } from "@/lib/session-invalidation";

type ActivityType = "run" | "track" | "gym" | "ride" | "swim";

type Block = {
  uid: string;
  sessionId: string | null;
  activity: ActivityType;
  feel: number;
  wentWell: string;
  wasDifficult: string;
  niggles: string;
  note: string;
  gymDuration: number;
  uploadedFiles: { name: string; started_at: string | null; points: number }[];
  uploading: boolean;
  saved: boolean;
};

function newBlock(): Block {
  return { uid: crypto.randomUUID(), sessionId: null, activity: "run", feel: 7, wentWell: "", wasDifficult: "", niggles: "", note: "", gymDuration: 60, uploadedFiles: [], uploading: false, saved: false };
}

export function DailyLogSessions({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const today = todayISO();
  const upload = useServerFn(uploadAndParseSessionFile);

  const { data: existing = [] } = useQuery({
    queryKey: ["daily-log-sessions", athleteId, today],
    queryFn: async () => {
      const { data } = await supabase.from("sessions")
        .select("id, title, activity_type, total_distance_m, total_time_seconds, completed_at")
        .eq("athlete_id", athleteId).eq("session_date", today)
        .order("created_at");
      return data ?? [];
    },
  });

  const [blocks, setBlocks] = useState<Block[]>([newBlock()]);

  function updateBlock(uid: string, patch: Partial<Block>) {
    setBlocks((prev) => prev.map((b) => b.uid === uid ? { ...b, ...patch } : b));
  }

  async function ensureSession(b: Block, title: string): Promise<string> {
    if (b.sessionId) return b.sessionId;
    const existingSession = existing.find((s: any) => s.completed_at && (s.activity_type === b.activity || b.activity === "run" || b.activity === "track"));
    if (existingSession?.id) {
      updateBlock(b.uid, { sessionId: existingSession.id });
      return existingSession.id;
    }
    const isTraining = b.activity === "run" || b.activity === "track";
    const insert: any = {
      athlete_id: athleteId,
      session_date: today,
      title,
      day_type: isTraining ? "training" : "cross_training",
      activity_type: b.activity,
      completed_at: new Date().toISOString(),
    };
    if (isTraining) { insert.intent = "aerobic"; insert.structure = "continuous"; }
    const { data, error } = await supabase.from("sessions").insert(insert).select("id").single();
    if (error) throw error;
    updateBlock(b.uid, { sessionId: data.id });
    return data.id;
  }

  async function handleFiles(b: Block, files: FileList) {
    if (b.activity === "gym" || b.activity === "swim") {
      toast.error(b.activity === "swim" ? "Swim FIT parsing coming soon — log manually." : "Gym is logged manually (no file).");
      return;
    }
    updateBlock(b.uid, { uploading: true });
    try {
      const sessionId = await ensureSession(b, `${labelFor(b.activity)} session`);
      const uploads: Block["uploadedFiles"] = [...b.uploadedFiles];
      for (const f of Array.from(files)) {
        const buf = await f.arrayBuffer();
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        const kind = f.name.toLowerCase().endsWith(".fit") ? "fit" : "gpx";
        const res = await upload({ data: { athleteId, sessionId, filename: f.name, kind, fileBase64: b64 } });
        uploads.push({ name: f.name, started_at: (res?.file as any)?.started_at ?? null, points: res?.points ?? 0 });
      }
      updateBlock(b.uid, { uploadedFiles: uploads });
      toast.success(`Uploaded ${files.length} file(s)`);
      qc.invalidateQueries({ queryKey: ["daily-log-sessions", athleteId, today] });
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed");
    } finally {
      updateBlock(b.uid, { uploading: false });
    }
  }

  function detectGap(b: Block): number | null {
    const times = b.uploadedFiles.map((f) => f.started_at).filter(Boolean).map((s) => new Date(s!).getTime()).sort();
    if (times.length < 2) return null;
    let maxGap = 0;
    for (let i = 1; i < times.length; i++) maxGap = Math.max(maxGap, (times[i] - times[i - 1]) / 60000);
    return maxGap;
  }

  async function saveBlock(b: Block) {
    try {
      const sessionId = await ensureSession(b, `${labelFor(b.activity)} session`);
      const sessionPatch: any = { rpe: b.feel };
      if (b.activity === "gym") sessionPatch.total_time_seconds = b.gymDuration * 60;
      if (b.note) sessionPatch.notes = b.note;
      await supabase.from("sessions").update(sessionPatch).eq("id", sessionId);
      await supabase.from("session_insights").upsert({
        session_id: sessionId,
        athlete_id: athleteId,
        feel_score: b.feel,
        went_well: b.wentWell || null,
        was_difficult: b.wasDifficult || null,
        niggles: b.niggles || null,
        end_of_day_note: null,
      } as any, { onConflict: "session_id" } as any);
      updateBlock(b.uid, { saved: true });
      toast.success("Session saved");
      invalidateSession(qc, sessionId, athleteId);
    } catch (err: any) {
      toast.error(err?.message ?? "Save failed");
    }
  }

  async function removeBlock(uid: string) {
    const b = blocks.find((x) => x.uid === uid);
    if (b?.sessionId && confirm("Delete this session record too?")) {
      await supabase.from("sessions").delete().eq("id", b.sessionId);
      qc.invalidateQueries({ queryKey: ["daily-log-sessions", athleteId, today] });
    }
    setBlocks((prev) => prev.filter((x) => x.uid !== uid));
    if (blocks.length === 1) setBlocks([newBlock()]);
  }

  return (
    <div className="space-y-4">
      {existing.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Already logged today: {existing.map((s: any) => `${labelFor((s.activity_type ?? "run") as ActivityType)}${s.completed_at ? " ✓" : ""}`).join(" · ")}
        </div>
      )}
      {blocks.map((b, idx) => {
        const gap = detectGap(b);
        return (
          <Card key={b.uid}>
            <CardContent className="pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Session {idx + 1}</div>
                <Button variant="ghost" size="sm" onClick={() => removeBlock(b.uid)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Activity type</Label>
                  <Select value={b.activity} onValueChange={(v) => updateBlock(b.uid, { activity: v as ActivityType })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="run">Run</SelectItem>
                      <SelectItem value="track">Track</SelectItem>
                      <SelectItem value="gym">Gym</SelectItem>
                      <SelectItem value="ride">Ride</SelectItem>
                      <SelectItem value="swim">Swim</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {b.activity !== "gym" && b.activity !== "swim" && (
                  <div>
                    <Label className="text-xs">Upload .fit / .gpx (bulk OK)</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <Input type="file" accept=".fit,.gpx" multiple onChange={(e) => e.target.files && handleFiles(b, e.target.files)} />
                      {b.uploading && <Loader2 className="h-4 w-4 animate-spin" />}
                    </div>
                  </div>
                )}
                {b.activity === "gym" && (
                  <div>
                    <Label className="text-xs">Duration (min)</Label>
                    <Input type="number" value={b.gymDuration} onChange={(e) => updateBlock(b.uid, { gymDuration: Number(e.target.value) })} className="mt-1" />
                  </div>
                )}
              </div>

              {b.uploadedFiles.length > 0 && (
                <div className="text-xs space-y-1 border rounded p-2 bg-muted/20">
                  {b.uploadedFiles.map((f) => (
                    <div key={f.name} className="flex items-center gap-2">
                      <Upload className="h-3 w-3 text-muted-foreground" /> <span className="font-mono">{f.name}</span>
                      {f.started_at && <span className="text-muted-foreground">· started {new Date(f.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
                      <span className="text-muted-foreground">· {f.points} pts</span>
                    </div>
                  ))}
                  {gap != null && gap > 90 && (
                    <div className="flex items-center gap-1 text-amber-600 mt-1">
                      <AlertTriangle className="h-3 w-3" /> Files are {Math.round(gap)} min apart — they may be separate sessions. Consider splitting into another block.
                    </div>
                  )}
                  {gap != null && gap <= 90 && (
                    <div className="text-muted-foreground">Grouped as steps of one session (gap {Math.round(gap)} min).</div>
                  )}
                </div>
              )}

              <div>
                <Label className="text-xs">How did it feel? ({b.feel}/10)</Label>
                <Slider min={1} max={10} step={1} value={[b.feel]} onValueChange={(v) => updateBlock(b.uid, { feel: v[0] })} className="mt-2" />
              </div>
              <Textarea placeholder="What went well? (optional)" value={b.wentWell} onChange={(e) => updateBlock(b.uid, { wentWell: e.target.value })} />
              <Textarea placeholder="What was difficult? (optional)" value={b.wasDifficult} onChange={(e) => updateBlock(b.uid, { wasDifficult: e.target.value })} />
              <Textarea placeholder="Any niggles or discomfort? (optional)" value={b.niggles} onChange={(e) => updateBlock(b.uid, { niggles: e.target.value })} />
              <Textarea placeholder="Session note (optional)" value={b.note} onChange={(e) => updateBlock(b.uid, { note: e.target.value })} />

              <Button onClick={() => saveBlock(b)} className="w-full">
                {b.saved ? <><CheckCircle2 className="h-4 w-4 mr-1" /> Saved · update</> : "Save session"}
              </Button>
            </CardContent>
          </Card>
        );
      })}
      <Button variant="outline" className="w-full" onClick={() => setBlocks((p) => [...p, newBlock()])}>
        <Plus className="h-4 w-4 mr-1" /> Add another session
      </Button>
    </div>
  );
}

function labelFor(a: ActivityType) {
  return { run: "Run", track: "Track", gym: "Gym", ride: "Ride", swim: "Swim" }[a];
}