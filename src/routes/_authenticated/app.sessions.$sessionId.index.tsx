import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { secToClock, clockToSec, metersFmt } from "@/lib/format";
import { sessionClassificationLabel } from "@/lib/session-categories";
import { saveSessionAsTemplate } from "@/lib/templates";
import { useAuthUser, useMyRoles } from "@/lib/use-auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { CheckCircle2, Apple, BookmarkPlus, LineChart, Sparkles } from "lucide-react";
import { PostSessionInsightModal } from "@/components/post-session-insight-modal";
import { useServerFn } from "@tanstack/react-start";
import { getLatestAthleteNote, generateSessionNote, getAiAccessStatus } from "@/lib/ai.functions";
import ReactMarkdown from "react-markdown";
import { markAttendance } from "@/lib/messages.functions";
import { Switch } from "@/components/ui/switch";
import { UserAvatar } from "@/components/user-avatar";
import { ActivityIcon } from "@/lib/activity-icon";
import { invalidateSession } from "@/lib/session-invalidation";
import { deleteSession, uploadAndParseSessionFile } from "@/lib/session-files.functions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { computeStrideLengthM, formatStride } from "@/lib/session-metrics";

export const Route = createFileRoute("/_authenticated/app/sessions/$sessionId/")({
  component: SessionDetail,
});

function SessionDetail() {
  const { sessionId } = Route.useParams();
  const qc = useQueryClient();
  const removeSession = useServerFn(deleteSession);
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const [tplName, setTplName] = useState("");
  const [insightOpen, setInsightOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);

  // ✅ FIT upload setup
  const uploadFile = useServerFn(uploadAndParseSessionFile);
  const [uploading, setUploading] = useState(false);

  const {
    data: session,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("*, athletes(name, profile_image_url)")
        .eq("id", sessionId)
        .single();

      if (error) {
        console.error("session error:", error);
        return null;
      }

      return data;
    },
    retry: false,
  });

  const { data: steps = [] } = useQuery({
    queryKey: ["steps", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("steps").select("*").eq("session_id", sessionId).order("step_order");

      if (error) {
        console.error("steps error:", error);
        return [];
      }

      return data ?? [];
    },
  });

  const stepIds = steps?.map((s) => s.id) ?? [];
  const { data: results = [], isFetching: resultsLoading } = useQuery({
    queryKey: ["results", sessionId, stepIds.join(",")],
    enabled: stepIds.length > 0,
    queryFn: async () => {
      if (!stepIds.length) return [];

      const { data, error } = await supabase
        .from("interval_results")
        .select("*")
        .in("step_id", stepIds)
        .order("set_number")
        .order("rep_number");

      if (error) {
        console.error("results error:", error);
        return [];
      }

      return data ?? [];
    },
  });

  const { data: zoneTime } = useQuery({
    queryKey: ["zone-time", sessionId],
    queryFn: async () => {
      const { data } = await supabase
        .from("session_zone_time")
        .select("zone, seconds, source")
        .eq("session_id", sessionId);
      return data ?? [];
    },
  });

  const { data: fatigue } = useQuery({
    queryKey: ["fatigue", sessionId],
    queryFn: async () => {
      const { data } = await supabase.from("session_fatigue").select("*").eq("session_id", sessionId);
      return data ?? [];
    },
  });

  const { data: fuelEvents } = useQuery({
    queryKey: ["fuel-events", sessionId],
    queryFn: async () => {
      const { data } = await supabase
        .from("session_fuel_events")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at");
      return data ?? [];
    },
  });

  const { data: insight } = useQuery({
    queryKey: ["session_insights", sessionId],
    queryFn: async () => {
      const { data } = await supabase
        .from("session_insights" as any)
        .select("*")
        .eq("session_id", sessionId)
        .maybeSingle();
      return data as any;
    },
  });

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);

    const reader = new FileReader();

    reader.onload = async () => {
      const base64 = String(reader.result || "").split(",")[1];

      try {
        const res: any = await uploadFile({
          data: {
            athleteId: session!.athlete_id,
            sessionId: sessionId,
            filename: file.name,
            kind: file.name.toLowerCase().endsWith(".gpx") ? "gpx" : "fit",
            fileBase64: base64,
          },
        });

        if (res?.error) {
          throw new Error(res.error);
        }

        toast.success("File uploaded and session updated");

        qc.invalidateQueries({ queryKey: ["session", sessionId] });
        qc.invalidateQueries({ queryKey: ["steps", sessionId] });
        qc.invalidateQueries({ queryKey: ["results", sessionId] });
        qc.invalidateQueries({ queryKey: ["raw-points", sessionId] });
        qc.invalidateQueries({ queryKey: ["zone-time", sessionId] });
        qc.invalidateQueries({ queryKey: ["fatigue", sessionId] });
      } catch (err: any) {
        console.error("FIT upload error:", err);
        toast.error(err.message);
      }

      setUploading(false);
    };

    reader.readAsDataURL(file);
  }

  async function toggleRaceStatus() {
    if (!session) return;

    const isCurrentlyRace = session.day_type === "race";

    // ✅ REMOVE RACE
    if (isCurrentlyRace) {
      const { data: updatedSession, error } = await supabase
        .from("sessions")
        .update({ day_type: "training" })
        .eq("id", sessionId)
        .select()
        .single();

      if (error) {
        toast.error(error.message);
        return;
      }

      // ✅ delete linked race
      await (supabase.from("performances") as any).delete().eq("session_id", sessionId);

      // ✅ IMPORTANT: update React Query cache
      qc.setQueryData(["session", sessionId], updatedSession);

      toast("Race removed ✅");

      qc.invalidateQueries({ queryKey: ["races", session.athlete_id] });

      return;
    }

    // ✅ Now handle race creation — switch to race first
    const { data: updatedSession, error: updateError } = await supabase
      .from("sessions")
      .update({ day_type: "race" })
      .eq("id", sessionId)
      .select()
      .single();

    if (updateError) {
      toast.error(updateError.message);
      return;
    }

    qc.setQueryData(["session", sessionId], updatedSession);

    if (session.completed_at && session.total_time_seconds && session.total_distance_m) {
      // ✅ prevent duplicates
      const { data: existing } = await (supabase.from("performances") as any)
        .select("id")
        .eq("session_id", sessionId)
        .maybeSingle();

      if (existing) {
        toast("Race already exists");
        return;
      }

      // ✅ FORCE CACHE UPDATE
      qc.setQueryData(["session", sessionId], updatedSession);

      // create performance
      const payload = {
        athlete_id: session.athlete_id,
        performance_date: session.session_date,
        distance_m: Math.round(Number(session.total_distance_m)),
        time_seconds: Number(session.total_time_seconds),
        event_name: session.title || null,
        notes: session.notes || null,
        session_id: sessionId, // ✅ critical
        is_pb: false,
        context: "race",
      };

      const { error: perfError } = await (supabase.from("performances") as any).insert(payload);

      if (perfError) {
        toast.error(perfError.message);
        return;
      }

      toast.success("Race created ✅");

      qc.invalidateQueries({ queryKey: ["session", sessionId] });
      qc.invalidateQueries({ queryKey: ["races", session.athlete_id] });
      qc.invalidateQueries({ queryKey: ["my-pbs", session.athlete_id] });
    } else {
      toast("Add totals to create race");
    }
  }
  async function saveTitle() {
    if (!session?.id) return;

    // ✅ start saving
    setSavingTitle(true);

    const { error } = await supabase.from("sessions").update({ title: titleValue }).eq("id", session.id);

    // ✅ stop saving
    setSavingTitle(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    setEditingTitle(false);

    qc.invalidateQueries({ queryKey: ["session", sessionId] });
  }

  useEffect(() => {
    if (session?.title) {
      setTitleValue(session.title);
    }
  }, [session?.title]);

  if (isLoading)
    return (
      <AppShell>
        <p>Loading…</p>
      </AppShell>
    );
  if (error || !session) {
    return (
      <AppShell>
        <div className="space-y-3 max-w-lg">
          <h1 className="text-lg font-semibold">Session not found</h1>
          <p className="text-sm text-muted-foreground">
            This session may have been deleted, or you may not have access to it.
            {error ? (
              <>
                {" "}
                <span className="block mt-1 text-xs">({(error as any).message})</span>
              </>
            ) : null}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/app/sessions">← Back to sessions</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const canSaveAsTemplate = isCoach && (session as any).day_type === "training";

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <div>
          <Link to="/app/sessions" className="text-sm text-muted-foreground underline">
            ← Sessions
          </Link>
          <div className="flex items-start justify-between gap-3 mt-2">
            <div className="flex items-start gap-3">
              <UserAvatar
                name={session.athletes?.name}
                imageUrl={(session.athletes as any)?.profile_image_url}
                size="lg"
              />
              <div>
                <div className="flex items-center gap-2">
                  <ActivityIcon session={session as any} size={22} className="text-muted-foreground" />

                  {editingTitle ? (
                    <input
                      value={titleValue}
                      onChange={(e) => setTitleValue(e.target.value)}
                      onBlur={saveTitle}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.currentTarget.blur();
                        }
                      }}
                      className="text-2xl font-bold bg-transparent outline-none w-full"
                      autoFocus
                    />
                  ) : (
                    <h1
                      className="text-2xl font-bold cursor-pointer flex items-center gap-2"
                      onClick={() => setEditingTitle(true)}
                    >
                      {session.title}
                      {savingTitle && <span className="text-xs text-muted-foreground">Saving…</span>}
                    </h1>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {session.session_date} · {session.athletes?.name} · {sessionClassificationLabel(session as any)}
                  {(session as any).applied_from_template_id && <span className="ml-2 italic">· from template</span>}
                  {session.completed_at && <span className="ml-2 text-emerald-600">Completed</span>}
                  {session.completed_at && session.rpe != null && (
                    <span className="ml-2">
                      · RPE <span className="tabular-nums font-medium">{session.rpe}</span>/10
                    </span>
                  )}
                </p>
              </div>
            </div>
            {canSaveAsTemplate && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setTplName(session.title ?? "");
                  setSaveTplOpen(true);
                }}
              >
                <BookmarkPlus className="h-4 w-4 mr-1" />
                Save as template
              </Button>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              {/* ✅ Mark as Race */}

              <Button
                size="sm"
                variant={session.day_type === "race" ? "destructive" : "outline"}
                onClick={toggleRaceStatus}
              >
                {session.day_type === "race" ? "Remove Race" : "Mark as Race"}
              </Button>

              {/* ✅ Existing analysis */}
              {session.completed_at && (
                <Button asChild size="sm" variant="outline">
                  <Link to="/app/sessions/$sessionId/analysis" params={{ sessionId }}>
                    <LineChart className="h-4 w-4 mr-1" />
                    View analysis
                  </Link>
                </Button>
              )}

              {session.day_type === "race" && session.completed_at && (
                <Button asChild size="sm" variant="outline">
                  <Link to="/app/races">Race Analysis</Link>
                </Button>
              )}
            </div>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                if (!confirm("Delete this session? This cannot be undone.")) return;

                removeSession({ data: { sessionId } }).then(() => {
                  window.location.href = "/app/sessions";
                });
              }}
            >
              Delete
            </Button>
          </div>
        </div>
        {session.notes && (
          <Card>
            <CardContent className="pt-4 text-sm">{session.notes}</CardContent>
          </Card>
        )}
        <div className="space-y-3">
          {stepIds.length > 0 && resultsLoading && !results ? (
            <Card>
              <CardContent className="pt-4 text-sm text-muted-foreground">Loading session data…</CardContent>
            </Card>
          ) : (
            (steps ?? []).map((step: any) => (
              <StepBlock
                key={step.id}
                session={session}
                step={step}
                results={(results ?? []).filter((r: any) => r.step_id === step.id)}
                fatigue={(fatigue ?? []).find((f: any) => f.step_id === step.id)}
                fuelEvents={(fuelEvents ?? []).filter((f: any) => f.step_id === step.id)}
              />
            ))
          )}
        </div>
        <SessionSummary
          session={session}
          results={results ?? []}
          onSaved={() => invalidateSession(qc, sessionId, session.athlete_id)}
          onCompleted={() => setInsightOpen(true)}
        />
        {/* ✅ FIT Upload */}
        <Card>
          <CardHeader>
            <CardTitle>Attach activity file</CardTitle>
            <CardDescription>Upload FIT or GPX file to automatically populate this session</CardDescription>
          </CardHeader>
          <CardContent>
            <input type="file" accept=".fit,.gpx" disabled={uploading} onChange={handleFileUpload} />
          </CardContent>
        </Card>

        {isCoach && (
          <AttendanceCard
            sessionId={sessionId}
            athleteId={session.athlete_id}
            athleteName={session.athletes?.name ?? "Athlete"}
          />
        )}
        {insight && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Athlete reflection</CardTitle>
              <CardDescription>How the session felt afterwards.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Feel</span>
                <span className="font-display text-2xl font-extrabold tabular-nums">
                  {insight.feel_score ?? "—"}
                  <span className="text-sm font-normal text-muted-foreground">/10</span>
                </span>
              </div>
              {insight.went_well && (
                <p>
                  <span className="text-xs text-muted-foreground uppercase tracking-wider mr-2">Went well</span>
                  {insight.went_well}
                </p>
              )}
              {insight.was_difficult && (
                <p>
                  <span className="text-xs text-muted-foreground uppercase tracking-wider mr-2">Difficult</span>
                  {insight.was_difficult}
                </p>
              )}
              {insight.niggles && (
                <p className="text-amber-500">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider mr-2">Niggles</span>
                  {insight.niggles}
                </p>
              )}
            </CardContent>
          </Card>
        )}
        <SessionAvgFatigue rows={fatigue ?? []} />
        <ZoneTimePanel
          rows={(zoneTime ?? []).filter((r: any) => r.source === "pace")}
          title="Time in pace zones"
          subtitle="Pace-based"
        />
        <ZoneTimePanel
          rows={(zoneTime ?? []).filter((r: any) => r.source === "hr")}
          title="Time in HR zones"
          subtitle="HR-based"
        />
        <FuelingPanel session={session} />
      </div>

      <Dialog open={saveTplOpen} onOpenChange={setSaveTplOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save session as template</DialogTitle>
            <DialogDescription>
              Saves the structure (steps, sets, reps, targets, recovery) — not athlete, date, or results.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Template name</Label>
            <Input
              className="mt-1"
              value={tplName}
              onChange={(e) => setTplName(e.target.value)}
              placeholder="e.g. Tuesday threshold — 6x800m"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveTplOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!tplName.trim()) {
                  toast.error("Name required");
                  return;
                }
                const res = await saveSessionAsTemplate({ sessionId, ownerUserId: user!.id, name: tplName.trim() });
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success("Template saved");
                setSaveTplOpen(false);
                qc.invalidateQueries({ queryKey: ["templates"] });
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PostSessionInsightModal
        open={insightOpen}
        onOpenChange={setInsightOpen}
        sessionId={sessionId}
        athleteId={session.athlete_id}
        onSaved={() => qc.invalidateQueries({ queryKey: ["session_insights", sessionId] })}
      />
      <div className="max-w-4xl mt-4">
        <SessionAINote sessionId={sessionId} athleteId={session.athlete_id} />
      </div>
    </AppShell>
  );
}

function AttendanceCard({
  sessionId,
  athleteId,
  athleteName,
}: {
  sessionId: string;
  athleteId: string;
  athleteName: string;
}) {
  const qc = useQueryClient();
  const markFn = useServerFn(markAttendance);
  const { data: attended } = useQuery({
    queryKey: ["attendance", sessionId, athleteId],
    queryFn: async () => {
      const { data } = await supabase
        .from("session_attendance")
        .select("id")
        .eq("session_id", sessionId)
        .eq("athlete_id", athleteId)
        .maybeSingle();
      return !!data;
    },
  });
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Attendance</CardTitle>
        <CardDescription>Mark whether {athleteName} attended this session.</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-3">
        <Switch
          checked={!!attended}
          onCheckedChange={async (v) => {
            await markFn({ data: { sessionId, athleteId, attended: v } });
            qc.invalidateQueries({ queryKey: ["attendance", sessionId, athleteId] });
            toast.success(v ? "Marked attended" : "Marked absent");
          }}
        />
        <span className="text-sm text-muted-foreground">{attended ? "Attended" : "Not marked"}</span>
      </CardContent>
    </Card>
  );
}

function SessionAINote({ sessionId, athleteId }: { sessionId: string; athleteId: string }) {
  const getNote = useServerFn(getLatestAthleteNote);
  const gen = useServerFn(generateSessionNote);
  const access = useServerFn(getAiAccessStatus);
  const { data: ai } = useQuery({ queryKey: ["ai-access"], queryFn: () => access() });
  const { data: note, refetch } = useQuery({
    queryKey: ["ai-session-note", sessionId],
    queryFn: () => getNote({ data: { athleteId, kind: "session", sessionId } }),
  });
  if (ai && !ai.allowed) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--accent-red)]" /> AI session reflection
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {note?.content ? (
          <div className="text-sm prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown>{note.content}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No AI reflection yet.</p>
        )}
        <Button size="sm" variant="outline" onClick={() => gen({ data: { sessionId } }).then(() => refetch())}>
          {note?.content ? "Regenerate" : "Generate"}
        </Button>
      </CardContent>
    </Card>
  );
}

const ZONE_ORDER = ["easy", "steady", "threshold", "vo2", "rep", "sprint", "recovery"] as const;

function ZoneTimePanel({
  rows,
  title,
  subtitle,
}: {
  rows: { zone: string; seconds: number; source: string }[];
  title: string;
  subtitle: string;
}) {
  if (rows.length === 0) {
    return null;
  }
  const total = rows.reduce((a, r) => a + Number(r.seconds || 0), 0) || 1;
  const sorted = [...rows].sort((a, b) => ZONE_ORDER.indexOf(a.zone as any) - ZONE_ORDER.indexOf(b.zone as any));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex h-3 w-full overflow-hidden rounded bg-muted">
          {sorted.map((r) => (
            <div
              key={`${r.zone}-${r.source}`}
              className={zoneBarClass(r.zone)}
              style={{ width: `${(Number(r.seconds) / total) * 100}%` }}
            />
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
          {sorted.map((r) => (
            <div key={`${r.zone}-${r.source}`} className="flex justify-between border rounded px-2 py-1">
              <span className="capitalize flex items-center gap-2">
                <span className={`h-2 w-2 rounded ${zoneDotClass(r.zone)}`} />
                {r.zone}
              </span>
              <span className="tabular-nums">{secToClock(Number(r.seconds))}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function zoneBarClass(zone: string) {
  const m: Record<string, string> = {
    easy: "bg-emerald-400",
    steady: "bg-sky-400",
    threshold: "bg-amber-400",
    vo2: "bg-orange-500",
    rep: "bg-red-500",
    sprint: "bg-fuchsia-500",
    recovery: "bg-slate-300",
  };
  return m[zone] ?? "bg-muted";
}
function zoneDotClass(zone: string) {
  return zoneBarClass(zone);
}
