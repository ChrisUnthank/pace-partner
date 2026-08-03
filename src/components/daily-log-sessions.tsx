import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FeelFaces } from "@/components/feel-faces";
import { uploadAndParseSessionFile } from "@/lib/session-files.functions";
import { Loader2, Plus, Trash2, Upload, AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { todayISO } from "@/lib/format";
import { toast } from "sonner";
import { invalidateSession } from "@/lib/session-invalidation";

type ActivityType = "run" | "track" | "gym" | "ride" | "swim";

type Block = {
  uid: string;
  sessionId: string | null;
  activity: ActivityType;
  // RPE (effort, 1–10) and feel (subjective, FeelFaces) are two different
  // things that used to share one slider value — RPE drives training load
  // (session_training_load() reads sessions.rpe directly), feel is just
  // "how did it feel" and lives on session_insights. Both start null, not
  // defaulted, so an unset value is genuinely distinguishable from a real
  // answer of e.g. 5 — the Save gate below depends on that distinction.
  rpe: number | null;
  feel: number | null;
  wentWell: string;
  wasDifficult: string;
  niggles: string;
  note: string;
  gymDuration: number;
  gymCategory: string;
  gymSubtype: string;
  swimDistance: number;
  swimDuration: number;
  uploadedFiles: { name: string; started_at: string | null; points: number }[];
  uploading: boolean;
  saved: boolean;
};

function newBlock(): Block {
  return {
    uid: crypto.randomUUID(),
    sessionId: null,
    activity: "run",
    rpe: null,
    feel: null,
    wentWell: "",
    wasDifficult: "",
    niggles: "",
    note: "",
    gymDuration: 60,
    gymCategory: "",
    gymSubtype: "",
    swimDistance: 1000,
    swimDuration: 30,
    uploadedFiles: [],
    uploading: false,
    saved: false,
  };
}

const KNOWN_ACTIVITIES: ActivityType[] = ["run", "track", "gym", "ride", "swim"];

// Converts a session row that already exists for today — however it got
// there (a FIT/GPX upload from Bulk Upload or the session's own detail
// page, a coach logging on the athlete's behalf, a manual entry) — into
// a pre-filled block, so Daily Log recognizes and links back to it
// instead of treating it as something the athlete still needs to enter
// from scratch. `session_insights` and `session_files` come back from a
// same-table embed (real FK on both, unlike a cross-schema profiles
// join), which PostgREST may shape as an array or a single object
// depending on version — normalized defensively here either way.
function sessionToBlock(s: any): Block {
  const insight = Array.isArray(s.session_insights) ? s.session_insights[0] : s.session_insights;
  const files = Array.isArray(s.session_files) ? s.session_files : s.session_files ? [s.session_files] : [];
  const activity: ActivityType = KNOWN_ACTIVITIES.includes(s.activity_type) ? s.activity_type : "run";
  return {
    uid: crypto.randomUUID(),
    sessionId: s.id,
    activity,
    rpe: s.rpe ?? null,
    feel: insight?.feel_score ?? null,
    wentWell: insight?.went_well ?? "",
    wasDifficult: insight?.was_difficult ?? "",
    niggles: insight?.niggles ?? "",
    note: s.notes ?? "",
    gymDuration: activity === "gym" && s.total_time_seconds ? Math.round(s.total_time_seconds / 60) : 60,
    gymCategory: s.gym_category ?? "",
    gymSubtype: s.gym_subtype ?? "",
    swimDistance: activity === "swim" && s.total_distance_m ? s.total_distance_m : 1000,
    swimDuration: activity === "swim" && s.total_time_seconds ? Math.round(s.total_time_seconds / 60) : 30,
    uploadedFiles: files.map((f: any) => ({
      name: f.original_filename ?? (f.file_kind ? `${f.file_kind} file` : "file"),
      started_at: f.started_at ?? null,
      points: 0,
    })),
    uploading: false,
    saved: s.rpe != null,
  };
}

export function DailyLogSessions({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const today = todayISO();
  const upload = useServerFn(uploadAndParseSessionFile);

  const { data: existing = [], isFetched } = useQuery({
    queryKey: ["daily-log-sessions", athleteId, today],
    queryFn: async () => {
      const { data, error } = await supabase.from("sessions")
        .select(`
          id, title, activity_type, day_type, total_distance_m, total_time_seconds,
          rpe, completed_at, notes, gym_category, gym_subtype,
          session_insights (feel_score, went_well, was_difficult, niggles),
          session_files (original_filename, file_kind, started_at)
        `)
        .eq("athlete_id", athleteId).eq("session_date", today)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const [blocks, setBlocks] = useState<Block[]>([newBlock()]);

  // Recognizes any session that already exists for today — regardless of
  // where it came from — and turns it into a linked, pre-filled block
  // instead of leaving it invisible until the athlete happens to pick a
  // matching activity type and save. Runs on every fetch (not just once)
  // so a session uploaded elsewhere while this page is already open still
  // shows up here on the next refetch, but a ref of session ids already
  // turned into a block keeps it from ever duplicating one.
  const seededSessionIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isFetched) return;
    setBlocks((prev) => {
      const known = new Set(prev.map((b) => b.sessionId).filter(Boolean) as string[]);
      const newOnes = (existing as any[]).filter((s) => !known.has(s.id) && !seededSessionIds.current.has(s.id));
      if (newOnes.length === 0) return prev;
      newOnes.forEach((s) => seededSessionIds.current.add(s.id));
      const newBlocks = newOnes.map(sessionToBlock);
      // Drop the still-untouched starter block once real sessions are
      // found, so an athlete doesn't see a stray empty "Session 1" sitting
      // next to the one that's already uploaded and just needs RPE.
      const withoutBlankStarter = prev.filter(
        (b) => b.sessionId || b.rpe != null || b.note || b.wentWell || b.wasDifficult || b.niggles || b.uploadedFiles.length > 0,
      );
      return [...withoutBlankStarter, ...newBlocks];
    });
  }, [existing, isFetched]);

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
      toast.error(b.activity === "swim" ? "Swim FIT parsing coming soon — log distance and duration manually below." : "Gym is logged manually (no file).");
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
    if (b.rpe == null) {
      toast.error("RPE is required before saving — how hard did it feel, 1–10?");
      return;
    }
    try {
      const sessionId = await ensureSession(b, `${labelFor(b.activity)} session`);
      const sessionPatch: any = { rpe: b.rpe };
      if (b.activity === "gym") {
        sessionPatch.total_time_seconds = b.gymDuration * 60;
        sessionPatch.gym_category = b.gymCategory || null;
        sessionPatch.gym_subtype = b.gymCategory === "strength_resistance" ? b.gymSubtype || null : null;
      }
      if (b.activity === "swim") {
        sessionPatch.total_time_seconds = b.swimDuration * 60;
        sessionPatch.total_distance_m = b.swimDistance;
      }
      if (b.note) sessionPatch.notes = b.note;
      await supabase.from("sessions").update(sessionPatch).eq("id", sessionId);
      await supabase.from("session_insights").upsert({
        session_id: sessionId,
        athlete_id: athleteId,
        feel_score: b.feel,
        went_well: b.wentWell || null,
        was_difficult: b.wasDifficult || null,
        niggles: b.niggles || null,
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
          Already logged today: {existing.map((s: any) => `${labelFor((s.activity_type ?? "run") as ActivityType)}${s.completed_at ? " ✓" : ""}${s.completed_at && s.rpe == null ? " (RPE missing)" : ""}`).join(" · ")}
        </div>
      )}
      {blocks.map((b, idx) => {
        const gap = detectGap(b);
        return (
          <Card key={b.uid}>
            <CardContent className="pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Session {idx + 1}</div>
                  {b.sessionId && (
                    <Link
                      to="/app/sessions/$sessionId"
                      params={{ sessionId: b.sessionId }}
                      className="inline-flex items-center gap-0.5 text-[10px] font-medium text-[var(--accent-red)] hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" /> Linked session
                    </Link>
                  )}
                </div>
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
                {b.activity === "gym" && (
                  <div>
                    <Label className="text-xs">Gym type</Label>
                    <Select
                      value={b.gymCategory}
                      onValueChange={(v) => updateBlock(b.uid, { gymCategory: v, gymSubtype: v === "strength_resistance" ? b.gymSubtype : "" })}
                    >
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Pick a type…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mobility">Mobility</SelectItem>
                        <SelectItem value="flexibility_core">Flexibility / Core</SelectItem>
                        <SelectItem value="circuit">Circuit</SelectItem>
                        <SelectItem value="strength_resistance">Strength &amp; Resistance</SelectItem>
                        <SelectItem value="cardio">Cardio</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {b.activity === "gym" && b.gymCategory === "strength_resistance" && (
                  <div>
                    <Label className="text-xs">Focus</Label>
                    <Select value={b.gymSubtype} onValueChange={(v) => updateBlock(b.uid, { gymSubtype: v })}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Pick a focus…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="upper">Upper</SelectItem>
                        <SelectItem value="lower">Lower</SelectItem>
                        <SelectItem value="full_body">Full body</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {b.activity === "swim" && (
                  <div>
                    <Label className="text-xs">Distance (m)</Label>
                    <Input type="number" value={b.swimDistance} onChange={(e) => updateBlock(b.uid, { swimDistance: Number(e.target.value) })} className="mt-1" />
                  </div>
                )}
                {b.activity === "swim" && (
                  <div>
                    <Label className="text-xs">Duration (min)</Label>
                    <Input type="number" value={b.swimDuration} onChange={(e) => updateBlock(b.uid, { swimDuration: Number(e.target.value) })} className="mt-1" />
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

              {/* RPE drives training load directly (session_training_load()
                  reads sessions.rpe) — required before this block can be
                  saved, not just a nice-to-have slider. */}
              <div>
                <Label className="text-xs">
                  RPE — how hard did it feel? {b.rpe != null ? `(${b.rpe}/10)` : <span className="text-amber-600">(required)</span>}
                </Label>
                <Slider min={1} max={10} step={1} value={[b.rpe ?? 5]} onValueChange={(v) => updateBlock(b.uid, { rpe: v[0] })} className="mt-2" />
              </div>

              {/* Feel is the separate, subjective "how did you feel" read —
                  same FeelFaces picker the session detail page uses, so an
                  athlete answering here or there never sees two different
                  scales for what's supposed to be one concept. Optional —
                  RPE alone is enough to drive training load. */}
              <div>
                <Label className="text-xs">How did you feel? (optional)</Label>
                <div className="mt-2">
                  <FeelFaces value={b.feel} onChange={(v) => updateBlock(b.uid, { feel: v })} size="sm" />
                </div>
              </div>

              <Textarea placeholder="What went well? (optional)" value={b.wentWell} onChange={(e) => updateBlock(b.uid, { wentWell: e.target.value })} />
              <Textarea placeholder="What was difficult? (optional)" value={b.wasDifficult} onChange={(e) => updateBlock(b.uid, { wasDifficult: e.target.value })} />
              <Textarea placeholder="Any niggles or discomfort? (optional)" value={b.niggles} onChange={(e) => updateBlock(b.uid, { niggles: e.target.value })} />

              {/* Single description field for this session — nothing else
                  in the app writes to sessions.notes, so there's exactly
                  one place this ever gets entered. */}
              <div>
                <Label className="text-xs">Description (optional)</Label>
                <Textarea placeholder="Anything worth noting about this session" value={b.note} onChange={(e) => updateBlock(b.uid, { note: e.target.value })} className="mt-1" />
              </div>

              <Button onClick={() => saveBlock(b)} className="w-full" disabled={b.rpe == null}>
                {b.saved ? <><CheckCircle2 className="h-4 w-4 mr-1" /> Saved · update</> : b.rpe == null ? "Enter RPE to save" : "Save session"}
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
