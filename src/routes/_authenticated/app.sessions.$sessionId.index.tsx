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
  const [allOpen, setAllOpen] = useState(false);

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

        .select(
          `
  id,
  location,
  terrain,
  average_temp_c,
  wind_kph,
  *,
  athletes(name, profile_image_url)
`,
        )

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
      qc.invalidateQueries({ queryKey: ["race-by-session", sessionId] });
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

  // "Monday, 26 May 2026" - parsed as a plain calendar date (no timezone shift)
  const formattedDate = session.session_date
    ? new Date(`${session.session_date}T00:00:00`).toLocaleDateString("en-AU", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl mx-auto">
        <Link to="/app/sessions" className="text-sm text-muted-foreground underline">
          ← Sessions
        </Link>

        {/* ───────────────── Header card: who / what / when + primary actions ───────────────── */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-3 min-w-0">
                <UserAvatar
                  name={session.athletes?.name}
                  imageUrl={(session.athletes as any)?.profile_image_url}
                  size="lg"
                />

                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <ActivityIcon session={session as any} size={22} className="text-muted-foreground shrink-0" />

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
                        className="text-2xl font-bold cursor-pointer"
                        onClick={() => setEditingTitle(true)}
                        title="Click to rename"
                      >
                        {session.title}
                        {savingTitle && <span className="text-xs font-normal text-muted-foreground ml-2">Saving…</span>}
                      </h1>
                    )}

                    <Select
                      value={session.terrain || ""}
                      onValueChange={async (value) => {
                        await supabase.from("sessions").update({ terrain: value }).eq("id", session.id);
                        qc.invalidateQueries({ queryKey: ["session", sessionId] });
                      }}
                    >
                      <SelectTrigger className="w-[110px] h-7 text-xs">
                        <SelectValue placeholder="Surface" />
                      </SelectTrigger>

                      <SelectContent>
                        <SelectItem value="track">Track</SelectItem>
                        <SelectItem value="road">Road</SelectItem>
                        <SelectItem value="trail">Trail</SelectItem>
                        <SelectItem value="grass">Grass</SelectItem>
                        <SelectItem value="treadmill">Treadmill</SelectItem>
                        <SelectItem value="mixed">Mixed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Day, date, athlete, classification, and status badges */}
                  <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground mt-1">
                    <span className="font-medium text-foreground">{formattedDate ?? session.session_date}</span>
                    <span>·</span>
                    <span>{session.athletes?.name}</span>
                    <span>·</span>
                    <span>{sessionClassificationLabel(session as any)}</span>

                    {(session as any).applied_from_template_id && (
                      <Badge variant="outline" className="font-normal">
                        From template
                      </Badge>
                    )}

                    {session.completed_at && (
                      <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 font-normal gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Completed
                      </Badge>
                    )}
                    {session.day_type === "race" && session.completed_at && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          const { data } = await (supabase as any)
                            .from("performances")
                            .select("id")
                            .eq("session_id", sessionId)
                            .maybeSingle();

                          if (!data?.id) {
                            console.log("No race found yet");
                            return;
                          }

                          window.location.href = `/app/races/${data.id}/analysis`;
                        }}
                      >
                        🏁 Race analysis
                      </Button>
                    )}
                    {session.completed_at && session.rpe != null && (
                      <Badge variant="outline" className="font-normal">
                        RPE {session.rpe}/10
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Actions, grouped together on the right */}
              <div className="flex items-center gap-2 flex-wrap justify-end">
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
                <label className="cursor-pointer">
                  <Button size="sm" variant="outline" disabled={uploading}>
                    {uploading ? "Uploading…" : "Upload activity"}
                  </Button>
                  <input
                    type="file"
                    accept=".fit,.gpx"
                    className="hidden"
                    disabled={uploading}
                    onChange={handleFileUpload}
                  />
                </label>
                <Button
                  size="sm"
                  variant={session.day_type === "race" ? "destructive" : "outline"}
                  onClick={toggleRaceStatus}
                >
                  {session.day_type === "race" ? "Remove race" : "Mark as race"}
                </Button>
                {session.completed_at && (
                  <Button asChild size="sm" variant="outline">
                    <Link to="/app/sessions/$sessionId/analysis" params={{ sessionId }}>
                      <LineChart className="h-4 w-4 mr-1" />
                      View analysis
                    </Link>
                  </Button>
                )}
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
          </CardContent>
        </Card>

        {/* ───────────────── Overview card: the four headline numbers + context ───────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Overview</CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">
            {(session.location || session.terrain || session.average_temp_c != null || session.wind_kph != null) && (
              <div className="text-sm text-muted-foreground">
                {[
                  session.location,
                  session.terrain ? session.terrain.charAt(0).toUpperCase() + session.terrain.slice(1) : null,
                  session.average_temp_c != null ? `${session.average_temp_c}°C` : null,
                  session.wind_kph != null ? `Wind ${session.wind_kph} km/h` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="border rounded-lg px-3 py-2">
                <div className="text-xs text-muted-foreground">Time</div>
                <div className="text-lg font-semibold tabular-nums">{secToClock(session.total_time_seconds || 0)}</div>
              </div>

              <div className="border rounded-lg px-3 py-2">
                <div className="text-xs text-muted-foreground">Distance</div>
                <div className="text-lg font-semibold tabular-nums">{metersFmt(session.total_distance_m || 0)}</div>
              </div>

              <div className="border rounded-lg px-3 py-2">
                <div className="text-xs text-muted-foreground">Pace</div>
                <div className="text-lg font-semibold tabular-nums">
                  {session.total_time_seconds && session.total_distance_m
                    ? secToClock((session.total_time_seconds / session.total_distance_m) * 1000)
                    : "—"}
                </div>
              </div>
              {/* ✅ Distance correction */}
              <div className="border-t pt-3 space-y-2">
                <Label className="text-xs text-muted-foreground">Distance correction (m)</Label>

                <Input
                  type="number"
                  placeholder="e.g. 210"
                  defaultValue={session.distance_adjustment_m ?? ""}
                  onBlur={async (e) => {
                    const val = Number(e.target.value) || 0;

                    await supabase.from("sessions").update({ distance_adjustment_m: val }).eq("id", session.id);

                    qc.invalidateQueries({ queryKey: ["session", sessionId] });
                  }}
                />

                {/* ✅ Mode select */}
                <div>
                  <Label className="text-xs text-muted-foreground">Correction method</Label>

                  <Select
                    value={session.distance_adjustment_mode ?? "uniform"}
                    onValueChange={async (val) => {
                      await supabase.from("sessions").update({ distance_adjustment_mode: val }).eq("id", session.id);

                      qc.invalidateQueries({ queryKey: ["session", sessionId] });
                    }}
                  >
                    <SelectTrigger className="w-full text-xs h-8">
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent>
                      <SelectItem value="uniform">Spread evenly</SelectItem>
                      <SelectItem value="start">Start GPS delay</SelectItem>
                      <SelectItem value="end">Finish GPS error</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* ✅ Feedback */}
                {session.distance_adjustment_m > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Applying +{session.distance_adjustment_m}m ({session.distance_adjustment_mode})
                  </p>
                )}
              </div>
              <div className="border rounded-lg px-3 py-2">
                <div className="text-xs text-muted-foreground">RPE</div>
                <div className="text-lg font-semibold tabular-nums">{session.rpe ?? "—"}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {session.notes && (
          <Card>
            <CardContent className="pt-4 text-sm">{session.notes}</CardContent>
          </Card>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">Workout structure</h2>
            <Button size="sm" variant="ghost" onClick={() => setAllOpen((v) => !v)}>
              {allOpen ? "Collapse all" : "Expand all"}
            </Button>
          </div>

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
                  fuelEvents={(fuelEvents ?? []).filter((f: any) => f.step_id === step.id)}
                  forceOpen={allOpen}
                />
              ))
            )}
          </div>
        </div>
        <SessionSummary
          session={session}
          results={results ?? []}
          onSaved={() => invalidateSession(qc, sessionId, session.athlete_id)}
          onCompleted={() => setInsightOpen(true)}
        />

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

function StepBlock({
  session,
  step,
  results,
  fuelEvents,
  forceOpen,
}: {
  session: any;
  step: any;
  results: any[];
  fuelEvents: any[];
  forceOpen?: boolean;
}) {
  const qc = useQueryClient();

  const isWork = step.kind === "work";
  const isRecovery = step.kind === "recovery";
  const isStrides = step.kind === "strides";

  const setCount = Math.max(1, step.set_count ?? 1);

  // ✅ START CLOSED (cleaner UX)
  const [open, setOpen] = useState(!!forceOpen);
  useEffect(() => {
    setOpen(!!forceOpen);
  }, [forceOpen]);

  const reps = Array.from({ length: step.reps || 1 }, (_, i) => i + 1);
  const sets = Array.from({ length: setCount }, (_, i) => i + 1);

  const [openSets, setOpenSets] = useState<Record<number, boolean>>({
    1: true,
  });

  function toggleSet(setN: number) {
    setOpenSets((prev) => ({
      ...prev,
      [setN]: !prev[setN],
    }));
  }

  async function saveRep(setNumber: number, repNumber: number, patch: any) {
    const row = { step_id: step.id, set_number: setNumber, rep_number: repNumber, ...patch };

    const { error } = await supabase
      .from("interval_results")
      .upsert(row, { onConflict: "step_id,set_number,rep_number" });

    if (error) {
      toast.error(`Save failed: ${error.message}`);
      return;
    }

    invalidateSession(qc, session.id, session.athlete_id);
  }

  return (
    <Card>
      {/* ✅ HEADER */}
      <CardHeader className="cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center justify-between bg-muted/40 rounded px-2 py-1">
          <CardTitle className="text-base capitalize flex items-center gap-2">
            {step.kind === "recovery" ? "Recovery" : step.kind}

            {isWork &&
              step.target_kind === "distance" &&
              ` · ${setCount > 1 ? `${setCount}×` : ""}${step.reps}×${metersFmt(step.target_distance_m)}`}

            {isWork && step.target_kind === "time" && ` · ${step.reps}×${secToClock(step.target_time_seconds)}`}

            {isStrides && ` · ${step.reps}×${metersFmt(step.target_distance_m)}`}
          </CardTitle>

          <div className="text-sm text-muted-foreground">{open ? "▼" : "▶"}</div>
        </div>
      </CardHeader>

      {/* ✅ SMOOTH COLLAPSE */}
      <div
        className={`transition-all duration-300 overflow-hidden ${
          open ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <CardContent>
          {(isWork || isStrides) && (
            <div className="space-y-3">
              {sets.map((setN) => {
                const isOpen = openSets[setN];

                return (
                  <div key={setN} className="border rounded-lg p-2">
                    {setCount > 1 && (
                      <div
                        className="flex items-center justify-between text-xs opacity-80 cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSet(setN);
                        }}
                      >
                        <div>Set {setN}</div>
                        <div>{isOpen ? "▼" : "▶"}</div>
                      </div>
                    )}

                    {isOpen && (
                      <div className="space-y-2 mt-2">
                        {reps.map((rep) => {
                          const r = results.find((x) => x.rep_number === rep && (x.set_number ?? 1) === setN);

                          return (
                            <RepRow
                              key={`${setN}-${rep}`}
                              step={step}
                              rep={rep}
                              result={r}
                              onSave={(p) => saveRep(setN, rep, p)}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {isRecovery && (
            <div className="space-y-2">
              {reps.map((rep) => {
                const r = results.find((x) => x.rep_number === rep);
                return <RepRow key={rep} step={step} rep={rep} result={r} onSave={(p) => saveRep(1, rep, p)} />;
              })}
            </div>
          )}

          {(step.kind === "warmup" || step.kind === "cooldown") && (
            <RepRow step={step} rep={1} result={results[0]} onSave={(p) => saveRep(1, 1, p)} />
          )}

          {(isWork || isStrides) && <LactateSummary results={results} />}
          {isWork && <WorkFuelNote step={step} sessionId={session.id} />}
        </CardContent>
      </div>
    </Card>
  );
}

function RepRow({ step, rep, result, onSave }: { step: any; rep: number; result?: any; onSave: (patch: any) => void }) {
  const isRecovery = step.kind === "recovery";
  const isWorkOrStride = step.kind === "work" || step.kind === "strides";

  const [time, setTime] = useState("");
  const [dist, setDist] = useState<string | number>("");
  const [hrEnd, setHrEnd] = useState<string | number>("");
  const [hrRec, setHrRec] = useState<string | number>("");
  const [hrAvg, setHrAvg] = useState<string | number>("");
  const [cadence, setCadence] = useState<string | number>("");
  const [stride, setStride] = useState<string | number>("");

  const [adjustmentNote, setAdjustmentNote] = useState<string>("");

  const [lactateTaken, setLactateTaken] = useState<boolean>(false);
  const [lactateMmol, setLactateMmol] = useState<string | number>("");
  const [lactateTiming, setLactateTiming] = useState<string>("end_of_rep");

  const [showNote, setShowNote] = useState(false);

  // ✅ Derived stride
  const distanceM = Number(dist);
  const timeSec =
    typeof time === "string" && time.includes(":")
      ? time.split(":").reduce((acc, part, i) => acc + Number(part) * (i === 0 ? 60 : 1), 0)
      : Number(time);

  const computedStride =
    distanceM > 0 && timeSec > 0 && Number(cadence) > 0 ? (distanceM / ((timeSec / 60) * Number(cadence))) * 100 : null;

  const resultKey = result?.id ?? "none";

  useEffect(() => {
    setTime(result?.actual_time_seconds ? secToClock(result.actual_time_seconds) : "");
    setDist(result?.actual_distance_m ?? "");
    setHrEnd(result?.hr_end ?? "");
    setHrRec(result?.hr_end_recovery ?? "");
    setHrAvg(result?.hr_avg ?? "");
    setCadence(result?.cadence ?? "");
    setStride(result?.stride_length_cm ?? "");
    setAdjustmentNote(result?.adjustment_note ?? "");
    setLactateTaken(!!result?.lactate_taken);
    setLactateMmol(result?.lactate_mmol ?? "");
    setLactateTiming(result?.lactate_timing ?? "end_of_rep");
  }, [resultKey]);

  function commit() {
    const patch: any = {
      actual_time_seconds: clockToSec(time as any),
      actual_distance_m: dist === "" ? null : Number(dist),
      hr_end: hrEnd === "" ? null : Number(hrEnd),
      hr_end_recovery: hrRec === "" ? null : Number(hrRec),
      hr_avg: hrAvg === "" ? null : Number(hrAvg),
      cadence: cadence === "" ? null : Number(cadence),
      stride_length_cm: stride === "" ? null : Number(stride),
      adjustment_note: adjustmentNote.trim() || null,
      lactate_taken: lactateTaken,
      lactate_mmol: lactateMmol === "" ? null : Number(lactateMmol),
      lactate_timing: lactateTaken ? lactateTiming : null,
    };

    if (patch.actual_time_seconds && patch.actual_distance_m) {
      patch.actual_pace_sec_per_km = (patch.actual_time_seconds / patch.actual_distance_m) * 1000;
    }

    onSave(patch);
  }

  // ✅ ADD THIS RIGHT HERE
  function getDropColor(drop: number) {
    if (drop >= 20) {
      return "h-9 flex items-center justify-center rounded border text-base font-semibold tabular-nums bg-emerald-500/15 text-emerald-700 border-emerald-300";
    }
    if (drop >= 10) {
      return "h-9 flex items-center justify-center rounded border text-base font-semibold tabular-nums bg-amber-500/15 text-amber-700 border-amber-300";
    }
    return "h-9 flex items-center justify-center rounded border text-base font-semibold tabular-nums bg-red-500/15 text-red-700 border-red-300";
  }

  return (
    <div className="space-y-2 border-l-2 pl-2">
      <div className="text-xs text-muted-foreground">Rep {rep}</div>

      {/* ✅ ROW 1 — CORE METRICS */}
      <div className="grid grid-cols-8 gap-2 text-sm items-end">
        <div>
          <Label className="text-xs">Time</Label>
          <Input value={time} onChange={(e) => setTime(e.target.value)} onBlur={commit} />
        </div>

        <div className="col-span-2">
          <Label className="text-xs">Dist</Label>

          <Input type="number" value={dist} onChange={(e) => setDist(e.target.value)} onBlur={commit} />
        </div>

        {!isRecovery && (
          <div>
            <Label className="text-xs">HR avg</Label>

            <Input
              type="number"
              className={Number(hrAvg) > 180 ? "border-red-400" : ""}
              value={hrAvg}
              onChange={(e) => setHrAvg(e.target.value)}
              onBlur={commit}
            />
          </div>
        )}

        <div>
          <Label className="text-xs">{isRecovery ? "HR rec" : "HR end"}</Label>
          <Input
            type="number"
            value={isRecovery ? hrRec : hrEnd}
            onChange={(e) => (isRecovery ? setHrRec(e.target.value) : setHrEnd(e.target.value))}
            onBlur={commit}
          />
        </div>

        {!isRecovery && Number(hrEnd) > 0 && Number(hrRec) >= 0 && (
          <div>
            <Label className="text-xs">Drop</Label>
            <div className={getDropColor(Number(hrEnd) - Number(hrRec))}>{Number(hrEnd) - Number(hrRec)}</div>
          </div>
        )}

        {!isRecovery && (
          <>
            <div>
              <Label className="text-xs">Cad</Label>

              <Input
                type="number"
                className={Number(cadence) < 165 ? "border-amber-400" : ""}
                value={cadence}
                onChange={(e) => setCadence(e.target.value)}
                onBlur={commit}
              />
            </div>

            <div className="col-span-1">
              <Label className="text-xs">Stride</Label>
              <Input
                type="number"
                value={stride !== "" ? stride : computedStride ? Math.round(computedStride) : ""}
                onChange={(e) => setStride(e.target.value)}
                onBlur={commit}
              />
            </div>
          </>
        )}
      </div>

      {/* ✅ ROW 2 — TOGGLES */}
      {isWorkOrStride && (
        <div className="flex items-center gap-4 text-xs mt-1">
          <button type="button" className="text-muted-foreground underline" onClick={() => setShowNote((v) => !v)}>
            Note
          </button>

          <label className="flex items-center gap-1.5">
            <Switch
              checked={lactateTaken}
              onCheckedChange={(v) => {
                setLactateTaken(v);
                setTimeout(commit, 0);
              }}
            />
            <span className="text-muted-foreground">Lactate</span>
          </label>
        </div>
      )}

      {/* ✅ ROW 3 — EXPANDED DETAILS */}
      {(showNote || lactateTaken) && (
        <div className="flex flex-wrap gap-2 mt-2 text-xs">
          {showNote && (
            <Input
              className="h-7 flex-1 min-w-[200px]"
              placeholder="Adjustment note..."
              value={adjustmentNote}
              onChange={(e) => setAdjustmentNote(e.target.value)}
              onBlur={commit}
            />
          )}

          {lactateTaken && (
            <>
              <Input
                className="h-7 w-20"
                type="number"
                step="0.1"
                value={lactateMmol}
                onChange={(e) => setLactateMmol(e.target.value)}
                onBlur={commit}
              />

              <Select
                value={lactateTiming}
                onValueChange={(v) => {
                  setLactateTiming(v);
                  setTimeout(commit, 0);
                }}
              >
                <SelectTrigger className="h-7 w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="end_of_rep">End of rep</SelectItem>
                  <SelectItem value="end_of_recovery">End of recovery</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function WorkFuelNote({ step, sessionId }: { step: any; sessionId: string }) {
  const qc = useQueryClient();
  const [note, setNote] = useState<string>(step.fuel_note ?? "");
  useEffect(() => {
    setNote(step.fuel_note ?? "");
  }, [step.id, step.fuel_note]);
  async function save() {
    const { error } = await supabase
      .from("steps")
      .update({ fuel_note: note.trim() || null })
      .eq("id", step.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["steps", sessionId] });
    toast.success("Fueling note saved");
  }
  return (
    <div className="mt-3 border-t pt-3 space-y-1.5">
      <Label className="text-xs flex items-center gap-1">
        <Apple className="h-3 w-3" /> Fueling note (this work block)
      </Label>
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. gel before rep 4, sips of water between sets"
        className="text-sm"
        rows={2}
      />
      <Button size="sm" variant="outline" onClick={save}>
        Save fueling note
      </Button>
    </div>
  );
}

function LactateSummary({ results }: { results: any[] }) {
  const rows = results.filter((r) => r.lactate_taken && r.lactate_mmol != null);
  if (rows.length === 0) return null;
  return (
    <div className="mt-3 border-t pt-3">
      <div className="text-xs font-semibold text-muted-foreground mb-1.5">Lactate readings</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        {rows.map((r) => (
          <div key={r.id} className="border rounded px-2 py-1 flex justify-between">
            <span className="text-muted-foreground">
              {(r.set_number ?? 1) > 1 ? `S${r.set_number} ` : ""}Rep {r.rep_number}
              {r.lactate_timing === "end_of_recovery" ? " · rec" : ""}
            </span>
            <span className="tabular-nums font-medium">{Number(r.lactate_mmol).toFixed(1)} mmol</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FuelingPanel({ session }: { session: any }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(session.fueling_notes ?? "");
  async function save() {
    const { error } = await supabase
      .from("sessions")
      .update({ fueling_notes: notes || null })
      .eq("id", session.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Fueling notes saved");
      qc.invalidateQueries({ queryKey: ["session", session.id] });
    }
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Fueling</CardTitle>
      </CardHeader>

      <CardContent className="space-y-2">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. gel before rep 4"
          rows={2}
          className="text-sm"
        />

        <Button size="sm" variant="outline" onClick={save}>
          Save
        </Button>
      </CardContent>
    </Card>
  );
}

function SessionSummary({
  session,
  results = [],
  onSaved,
  onCompleted,
}: {
  session: any;
  results?: any[];
  onSaved: () => void;
  onCompleted?: () => void;
}) {
  const [rpe, setRpe] = useState<number>(5);
  // Re-sync whenever the underlying session row changes (after server-side recompute).
  useEffect(() => {
    setRpe(session.rpe ?? 5);
  }, [session.rpe]);

  // Derived stride length: prefer an explicit per-rep value, else compute from
  // session totals + average rep cadence. Returns null when not enough data.
  const derivedStride = (() => {
    const explicit = results.map((r: any) => Number(r?.stride_length_cm)).filter((n) => Number.isFinite(n) && n > 0);
    if (explicit.length) {
      const avgCm = explicit.reduce((a, b) => a + b, 0) / explicit.length;
      return Number((avgCm / 100).toFixed(2));
    }
    const cads = results.map((r: any) => Number(r?.cadence)).filter((n) => Number.isFinite(n) && n > 0);
    const avgCad = cads.length ? cads.reduce((a, b) => a + b, 0) / cads.length : null;
    return computeStrideLengthM(session.total_distance_m, session.total_time_seconds, avgCad);
  })();

  async function complete() {
    const wasAlreadyComplete = !!session.completed_at;

    const { error } = await supabase
      .from("sessions")
      .update({
        rpe,
        ...(wasAlreadyComplete ? {} : { completed_at: new Date().toISOString() }),
      })
      .eq("id", session.id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(wasAlreadyComplete ? "Session updated" : "Session marked complete");
      onSaved();
      if (!wasAlreadyComplete) onCompleted?.();
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Session feedback</CardTitle>
      </CardHeader>

      <CardContent className="flex items-center gap-4">
        <div className="flex-1">
          <Label className="text-xs">RPE ({rpe})</Label>

          <Slider min={1} max={10} step={1} value={[rpe]} onValueChange={(v) => setRpe(v[0])} />
        </div>

        <Button onClick={complete} size="sm">
          {session.completed_at ? "Update" : "Complete"}
        </Button>
      </CardContent>
    </Card>
  );
}
