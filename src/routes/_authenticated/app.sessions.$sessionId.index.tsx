import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { secToClock, clockToSec, metersFmt, roundDistanceForDisplay, roundRecoverySeconds } from "@/lib/format";
import { sessionClassificationLabel } from "@/lib/session-categories";
import { stepKindBarClass, stepKindTextClass } from "@/lib/step-kind-colors";
import { saveSessionAsTemplate } from "@/lib/templates";
import { useAuthUser, useMyRoles } from "@/lib/use-auth";
import { AthleteSubnav } from "@/components/athlete-subnav";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  CheckCircle2,
  Apple,
  BookmarkPlus,
  LineChart,
  Sparkles,
  MapPin,
  Mountain,
  Thermometer,
  Wind,
  GripVertical,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Flame,
  Droplet,
  AlertTriangle,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PostSessionInsightModal } from "@/components/post-session-insight-modal";
import { FeelFaces } from "@/components/feel-faces";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import { markAttendance } from "@/lib/messages.functions";
import { Switch } from "@/components/ui/switch";
import { UserAvatar } from "@/components/user-avatar";
import { ActivityIcon } from "@/lib/activity-icon";
import { reconstructTrack } from "@/lib/gps-reconstruction";
import { invalidateSession } from "@/lib/session-invalidation";
import {
  deleteSession,
  uploadAndParseSessionFile,
  mergeSessionIntoAnother,
  rebuildSessionClassification,
} from "@/lib/session-files.functions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { computeStrideLengthM, formatStride } from "@/lib/session-metrics";
import { resolveStepTarget, resolvedTargetShortLabel } from "@/lib/target-resolution";
import { WorkTargetEditor } from "@/components/work-target-editor";

export const Route = createFileRoute("/_authenticated/app/sessions/$sessionId/")({
  component: SessionDetail,
});

function SessionDetail() {
  const { sessionId } = Route.useParams();
  const qc = useQueryClient();
  const removeSession = useServerFn(deleteSession);
  const mergeSession = useServerFn(mergeSessionIntoAnother);
  const rebuildClassification = useServerFn(rebuildSessionClassification);
  const [rebuilding, setRebuilding] = useState(false);
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
  const [distanceInput, setDistanceInput] = useState("");
  // Toggles the Workout structure card between its normal read/edit-reps
  // view and a drag-and-drop reorder view (warmup/work/recovery/cooldown
  // blocks can all move relative to each other — no anchoring). Scoped
  // to block order only; rep editing still happens in the normal view.
  const [structureEditMode, setStructureEditMode] = useState(false);

  // ✅ FIT upload setup
  const uploadFile = useServerFn(uploadAndParseSessionFile);
  const [uploading, setUploading] = useState(false);
  // "2 of 4" while a multi-file batch is in flight; empty for single files.
  const [uploadProgress, setUploadProgress] = useState("");
  // Triggers the hidden file input below via .click() — a <label> wrapping
  // a shadcn Button (a real <button>) doesn't reliably forward clicks to
  // an associated file input, since the click lands on the button itself
  // rather than the label. A ref + explicit .click() is the reliable way
  // to have a styled button open the native file picker.
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  athletes(name, profile_image_url, timezone)
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

  const {
    data: race,
    isLoading: raceLoading,
    error: raceError,
  } = useQuery({
    queryKey: ["race-by-session", sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const { data, error } = await supabase.from("performances").select("*").eq("session_id", sessionId).maybeSingle();

      if (error) throw error;
      return data;
    },
  });

  // Real clock start-time for the header, e.g. "6:42 PM" next to the date.
  // `sessions.session_date` is date-only — the actual recorded start
  // instant lives on session_files (earliest of however many files this
  // session merged). Manually-created sessions with no uploaded file have
  // no time to show, which is correct — nothing was actually recorded.
  const { data: earliestFileStart } = useQuery({
    queryKey: ["session-start-time", sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("session_files")
        .select("started_at")
        .eq("session_id", sessionId)
        .not("started_at", "is", null)
        .order("started_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.started_at ?? null;
    },
  });

  // Previous/next session for this athlete, ordered by date then id as a
  // tiebreak for same-day sessions — powers the < > navigation in the
  // header so a coach can step through an athlete's history without
  // returning to the calendar between each one. Two separate small queries
  // rather than one clever one: keeps each side's ordering/limit trivial to
  // read, and both are cheap (indexed on athlete_id + session_date).
  const { data: adjacentSessions } = useQuery({
    queryKey: ["session-adjacent", sessionId, session?.athlete_id, session?.session_date],
    enabled: !!session?.athlete_id && !!session?.session_date,
    queryFn: async () => {
      const athleteId = (session as any).athlete_id;
      const date = session!.session_date;

      const [{ data: prevRows, error: prevErr }, { data: nextRows, error: nextErr }] = await Promise.all([
        supabase
          .from("sessions")
          .select("id, session_date, title")
          .eq("athlete_id", athleteId)
          .or(`session_date.lt.${date},and(session_date.eq.${date},id.lt.${sessionId})`)
          .order("session_date", { ascending: false })
          .order("id", { ascending: false })
          .limit(1),
        supabase
          .from("sessions")
          .select("id, session_date, title")
          .eq("athlete_id", athleteId)
          .or(`session_date.gt.${date},and(session_date.eq.${date},id.gt.${sessionId})`)
          .order("session_date", { ascending: true })
          .order("id", { ascending: true })
          .limit(1),
      ]);
      if (prevErr) throw prevErr;
      if (nextErr) throw nextErr;

      return {
        prev: prevRows?.[0] ?? null,
        next: nextRows?.[0] ?? null,
      };
    },
  });


  // "8 × 1km + 90s jog recovery". Fetches every work step, not just the
  // first — a session can legitimately have more than one (e.g. a 2km
  // opener followed by 5 x 1km reps produces two separate work steps, one
  // per distinct rep distance), and showing only the first used to
  // silently drop the rest of the workout from this summary.
  const { data: workSteps } = useQuery({
    queryKey: ["overview-work-steps", sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("steps")
        .select("*")
        .eq("session_id", sessionId)
        .eq("kind", "work")
        .order("step_order");

      if (error) throw error;
      return data ?? [];
    },
  });

  // Zone profile for target resolution (Phase 3) — turns "95% threshold
  // pace" / "Z3" prescriptions into this athlete's concrete pace/HR ranges.
  const { data: zoneProfile } = useQuery({
    queryKey: ["zone-profile-for-targets", session?.athlete_id],
    enabled: !!session?.athlete_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_zone_profiles")
        .select("*")
        .eq("athlete_id", session!.athlete_id)
        .maybeSingle();
      return data;
    },
  });

  // Computed once here rather than inline in JSX — formatWorkoutStructure
  // now returns {main, recovery} per step so the recovery portion can be
  // styled smaller than the main "N × distance" part. Each entry also
  // carries the step's resolved target (null for Open) for display.
  const workoutStructures = useMemo(
    () =>
      (workSteps ?? [])
        .map((s) => {
          const f = formatWorkoutStructure(s);
          return f ? { ...f, target: resolvedTargetShortLabel(s, zoneProfile) } : null;
        })
        .filter((x): x is { main: string; recovery: string | null; target: string | null } => !!x),
    [workSteps, zoneProfile],
  );

  // Raw points + GPS reconstruction, purely to decide whether the manual
  // "Split corrections" UI needs to be shown at all. If reconstruction ran
  // clean (no dropouts/spikes detected), there's nothing for a coach to
  // second-guess — the automatic correction can be trusted. Only surface
  // the manual override when reconstruction actually had to flag something.
  const { data: rawPointsForConfidence = [] } = useQuery({
    queryKey: ["overview-raw-points", sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const PAGE_SIZE = 1000;
      const all: any[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("raw_session_points")
          .select("elapsed_s, distance_m")
          .eq("session_id", sessionId)
          .order("elapsed_s")
          .range(from, from + PAGE_SIZE - 1);
        if (error || !data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      return all;
    },
  });

  const splitReconstruction = useMemo(() => {
    if (!rawPointsForConfidence.length) return null;
    const officialDistance = session?.day_type === "race" ? (race?.distance_m ?? null) : null;
    return reconstructTrack(rawPointsForConfidence as any, officialDistance);
  }, [rawPointsForConfidence, session?.day_type, race?.distance_m]);

  // Reconstruction found nothing to flag -> automatic correction is
  // trustworthy -> manual overrides aren't needed for this session.
  const needsManualSplitCorrection = (splitReconstruction?.anomalies.length ?? 0) > 0;

  useEffect(() => {
    if (race?.distance_m != null) {
      setDistanceInput(String(race.distance_m));
    }
  }, [race?.distance_m]);

  // Other sessions for this athlete on the same calendar day — likely
  // candidates for merging, e.g. a cooldown that split off into its own
  // session because it was uploaded before the race got marked, so the
  // tighter same-session gap threshold applied at the time.
  //
  // Restricted to auto-uploaded (source = 'fit_import') sessions on both
  // sides — a manually-created planned session, strength session, or
  // cross-training day is NOT a candidate for "this looks like a split-off
  // warmup/cooldown of an upload", and merging into/from one would silently
  // destroy a real, unrelated session. Also excludes other races, since two
  // distinct races never belong merged together.
  const isFitImportSession = (session as any)?.source === "fit_import";
  const { data: sameDaySessions } = useQuery({
    queryKey: ["same-day-sessions", session?.athlete_id, session?.session_date, sessionId],
    enabled: !!session?.athlete_id && !!session?.session_date && isFitImportSession,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("id, title, total_distance_m, total_time_seconds, day_type, source")
        .eq("athlete_id", session!.athlete_id)
        .eq("session_date", session!.session_date)
        .eq("source", "fit_import")
        .neq("day_type", "race")
        .neq("id", sessionId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const [mergeTarget, setMergeTarget] = useState<{ id: string; title: string } | null>(null);
  const [merging, setMerging] = useState(false);
  const [ignoringId, setIgnoringId] = useState<string | null>(null);

  // Same-day sessions the coach/athlete has already confirmed are a
  // legitimate double day (not a split-off upload) get filtered out of the
  // banner here, rather than in the query itself — keeps the query simple
  // and means the banner updates the instant the ["session", sessionId]
  // query refetches after an ignore, with no extra invalidation to coordinate.
  const visibleSameDaySessions = (sameDaySessions ?? []).filter(
    (s: any) => !((session as any)?.same_day_ignored_ids ?? []).includes(s.id),
  );

  async function handleIgnoreSameDay(otherSessionId: string) {
    setIgnoringId(otherSessionId);
    try {
      const mine = new Set<string>((session as any)?.same_day_ignored_ids ?? []);
      mine.add(otherSessionId);

      const { data: otherRow, error: otherFetchErr } = await supabase
        .from("sessions")
        .select("same_day_ignored_ids")
        .eq("id", otherSessionId)
        .single();
      if (otherFetchErr) throw otherFetchErr;
      const theirs = new Set<string>((otherRow as any)?.same_day_ignored_ids ?? []);
      theirs.add(sessionId);

      const [{ error: err1 }, { error: err2 }] = await Promise.all([
        supabase.from("sessions").update({ same_day_ignored_ids: Array.from(mine) } as any).eq("id", sessionId),
        supabase.from("sessions").update({ same_day_ignored_ids: Array.from(theirs) } as any).eq("id", otherSessionId),
      ]);
      if (err1) throw err1;
      if (err2) throw err2;

      toast.success("Won't flag this pair again");
      qc.invalidateQueries({ queryKey: ["session", sessionId] });
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't save");
    }
    setIgnoringId(null);
  }


  async function clearReviewDismissed() {
    // Whenever composition changes (new file, merge, or a fresh classification
    // run), a previously "reviewed" session may need a fresh look — clear the
    // dismissed flag so the banner can reappear if still relevant.
    await supabase
      .from("sessions")
      .update({ review_dismissed_at: null } as any)
      .eq("id", sessionId);
  }

  async function handleMerge(otherSessionId: string) {
    setMerging(true);
    try {
      await mergeSession({ data: { sourceSessionId: otherSessionId, targetSessionId: sessionId } });
      await clearReviewDismissed();
      toast.success("Sessions merged");
      qc.invalidateQueries({ queryKey: ["session", sessionId] });
      qc.invalidateQueries({ queryKey: ["steps", sessionId] });
      qc.invalidateQueries({ queryKey: ["results", sessionId] });
      qc.invalidateQueries({ queryKey: ["raw-points", sessionId] });
      qc.invalidateQueries({ queryKey: ["same-day-sessions"] });
      qc.invalidateQueries({ queryKey: ["session-file-count", sessionId] });
    } catch (err: any) {
      toast.error(err?.message ?? "Merge failed");
    }
    setMerging(false);
    setMergeTarget(null);
  }

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

  const { data: fileCount = 0 } = useQuery({
    queryKey: ["session-file-count", sessionId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("session_files")
        .select("id", { count: "exact", head: true })
        .eq("session_id", sessionId);
      if (error) return 0;
      return count ?? 0;
    },
  });

  // Surfaces a file that was accepted (recognised, a session row exists)
  // but failed to actually parse — previously this failed completely
  // silently: uploadAndParseSessionFile still creates the session and
  // records the file with parse_error set, it just never runs the
  // classification/points build for it, so the session looked like an
  // empty "Completed" session with no indication anything had gone
  // wrong.
  const { data: failedFiles = [] } = useQuery({
    queryKey: ["session-failed-files", sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("session_files")
        .select("id, original_filename, parse_error")
        .eq("session_id", sessionId)
        .not("parse_error", "is", null);
      if (error) return [];
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

  // Reads one file into the base64 payload shape the server fn expects.
  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const s = String(r.result || "");
        const idx = s.indexOf(",");
        resolve(idx >= 0 ? s.slice(idx + 1) : s);
      };
      r.onerror = () => reject(r.error ?? new Error("Could not read file"));
      r.readAsDataURL(file);
    });
  }

  // Multi-file upload onto this session. Files are uploaded strictly one at
  // a time — each upload triggers rebuildSessionFromAllFiles on the server,
  // and firing several in parallel would have those rebuilds racing each
  // other over the same session's derived rows. Order of selection doesn't
  // matter: the rebuild merges by each file's own recorded timestamps.
  // A failure on one file (e.g. the duplicate-detection check) shows a
  // per-file toast and the loop carries on with the rest.
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // Reset immediately so re-selecting the same filename(s) fires onChange again.
    e.target.value = "";
    if (!files.length || !session) return;

    setUploading(true);

    let okCount = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadProgress(files.length > 1 ? `${i + 1} of ${files.length}` : "");

      try {
        const base64 = await fileToBase64(file);

        const res: any = await uploadFile({
          data: {
            athleteId: session.athlete_id,
            sessionId: sessionId,
            filename: file.name,
            kind: file.name.toLowerCase().endsWith(".gpx") ? "gpx" : "fit",
            fileBase64: base64,
          },
        });

        if (res?.error) {
          throw new Error(res.error);
        }

        okCount++;
      } catch (err: any) {
        console.error("FIT upload error:", err);
        toast.error(`${file.name}: ${err?.message ?? "Upload failed"}`);
      }
    }

    if (okCount > 0) {
      toast.success(
        okCount === 1 ? "File uploaded and session updated" : `${okCount} files uploaded and merged into this session`,
      );
      await clearReviewDismissed();

      qc.invalidateQueries({ queryKey: ["session", sessionId] });
      qc.invalidateQueries({ queryKey: ["steps", sessionId] });
      qc.invalidateQueries({ queryKey: ["results", sessionId] });
      qc.invalidateQueries({ queryKey: ["raw-points", sessionId] });
      qc.invalidateQueries({ queryKey: ["session-file-count", sessionId] });
    }

    setUploading(false);
    setUploadProgress("");
  }

  // Creates the performances row for this race-marked session, using
  // work-only distance/time where available (excludes any attached
  // warmup/cooldown — using the whole session's totals here was what
  // previously produced wildly inflated "Official Distance" values, e.g.
  // 14km instead of 7.4km). Shared by the "Mark as race" toggle below and
  // the "Recreate race record" recovery action on the Official Distance
  // card — a race-marked session can end up with no performances row at
  // all if a previous creation attempt errored, was interrupted, or predates
  // this fix, which is exactly the state that leaves Official Distance stuck
  // showing the full GPS total (uneditable) and the Race analysis button
  // unable to find anything to open.
  async function createPerformanceRecord() {
    if (!session) return false;

    if (!(session.completed_at && session.total_time_seconds && session.total_distance_m)) {
      toast("Add totals to create race");
      return false;
    }

    const { data: existing } = await (supabase.from("performances") as any)
      .select("id")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (existing) {
      toast("Race already exists");
      qc.invalidateQueries({ queryKey: ["race-by-session", sessionId] });
      return true;
    }

    const payload = {
      athlete_id: session.athlete_id,
      performance_date: session.session_date,
      distance_m: Math.round(Number((session as any).work_distance_m ?? session.total_distance_m)),
      time_seconds: Number((session as any).work_time_s ?? session.total_time_seconds),
      event_name: session.title || null,
      notes: session.notes || null,
      session_id: sessionId, // ✅ critical
      // is_pb intentionally omitted — a DB trigger (recompute_pb_after_perf_change)
      // recalculates it immediately after insert by comparing against this
      // athlete's actual history, so this always ends up correct whether or
      // not this particular race turns out to be a new PB.
      context: "race",
    };

    const { error: perfError } = await (supabase.from("performances") as any).insert(payload);

    if (perfError) {
      toast.error(perfError.message);
      return false;
    }

    toast.success("Race record created ✅");

    qc.invalidateQueries({ queryKey: ["session", sessionId] });
    qc.invalidateQueries({ queryKey: ["races", session.athlete_id] });
    qc.invalidateQueries({ queryKey: ["my-pbs", session.athlete_id] });
    qc.invalidateQueries({ queryKey: ["race-by-session", sessionId] });
    return true;
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

    await createPerformanceRecord();
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
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/app/sessions">← Back to sessions</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/app/sessions/calendar">Calendar</Link>
            </Button>
          </div>
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

  // "6:42 PM" — converted via the athlete's own timezone, falling back to
  // UTC to match the same fallback session-files.functions.ts uses server
  // side, so this display can never disagree with how the session's own
  // Morning/Afternoon/Evening title got picked.
  const localTime = earliestFileStart
    ? (() => {
        try {
          return new Intl.DateTimeFormat("en-AU", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
            timeZone: (session.athletes as any)?.timezone || "UTC",
          }).format(new Date(earliestFileStart));
        } catch {
          return null;
        }
      })()
    : null;

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Link to="/app/sessions" className="text-sm text-muted-foreground underline">
              ← Sessions
            </Link>
            <span className="text-muted-foreground/40">·</span>
            <Link to="/app/sessions/calendar" className="text-sm text-muted-foreground underline">
              Calendar
            </Link>
          </div>

          <div className="flex items-center gap-1">
            <Button
              asChild={!!adjacentSessions?.prev}
              size="sm"
              variant="outline"
              disabled={!adjacentSessions?.prev}
              title={adjacentSessions?.prev ? adjacentSessions.prev.title ?? "Previous session" : "No earlier session"}
            >
              {adjacentSessions?.prev ? (
                <Link to="/app/sessions/$sessionId" params={{ sessionId: adjacentSessions.prev.id }}>
                  <ChevronLeft className="h-4 w-4" />
                </Link>
              ) : (
                <span>
                  <ChevronLeft className="h-4 w-4" />
                </span>
              )}
            </Button>
            <Button
              asChild={!!adjacentSessions?.next}
              size="sm"
              variant="outline"
              disabled={!adjacentSessions?.next}
              title={adjacentSessions?.next ? adjacentSessions.next.title ?? "Next session" : "No later session"}
            >
              {adjacentSessions?.next ? (
                <Link to="/app/sessions/$sessionId" params={{ sessionId: adjacentSessions.next.id }}>
                  <ChevronRight className="h-4 w-4" />
                </Link>
              ) : (
                <span>
                  <ChevronRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          </div>
        </div>

        {isCoach && session.athlete_id && <AthleteSubnav athleteId={session.athlete_id} active="sessions" />}

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
                        <SelectItem value="path">Path</SelectItem>
                        <SelectItem value="grass">Grass</SelectItem>
                        <SelectItem value="treadmill">Treadmill</SelectItem>
                        <SelectItem value="mixed">Mixed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Day, date, athlete, classification, and status badges */}
                  <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground mt-1">
                    <span className="font-medium text-foreground">{formattedDate ?? session.session_date}</span>
                    {localTime && (
                      <>
                        <span>·</span>
                        <span>{localTime}</span>
                      </>
                    )}
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
                          const { data, error } = await (supabase as any)
                            .from("performances")
                            .select("id")
                            .eq("session_id", sessionId)
                            .maybeSingle();

                          if (error) {
                            toast.error(`Couldn't open race analysis: ${error.message}`);
                            return;
                          }

                          if (!data?.id) {
                            toast.error(
                              "No race record found for this session — use \"Recreate race record\" on the Official Distance card below to fix it.",
                            );
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
                <Button
                  size="sm"
                  variant="outline"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (uploadProgress ? `Uploading ${uploadProgress}…` : "Uploading…") : "Upload activity"}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".fit,.gpx"
                  multiple
                  className="hidden"
                  disabled={uploading}
                  onChange={handleFileUpload}
                />
                <Button
                  size="sm"
                  variant={session.day_type === "race" ? "destructive" : "outline"}
                  onClick={toggleRaceStatus}
                >
                  {session.day_type === "race" ? "Remove race" : "Mark as race"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={rebuilding}
                  onClick={async () => {
                    setRebuilding(true);
                    try {
                      await rebuildClassification({ data: { sessionId } });
                      toast.success("Classification rebuilt from source files");
                      await clearReviewDismissed();
                      qc.invalidateQueries({ queryKey: ["session", sessionId] });
                      qc.invalidateQueries({ queryKey: ["steps", sessionId] });
                      qc.invalidateQueries({ queryKey: ["results", sessionId] });
                      qc.invalidateQueries({ queryKey: ["raw-points", sessionId] });
                    } catch (err: any) {
                      toast.error(err?.message ?? "Rebuild failed");
                    }
                    setRebuilding(false);
                  }}
                >
                  {rebuilding ? "Rebuilding…" : "↻ Recompute classification"}
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

        {failedFiles.length > 0 && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="py-3 space-y-2">
              <p className="text-sm font-medium flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {failedFiles.length === 1 ? "A file failed to parse" : `${failedFiles.length} files failed to parse`} —
                this session has no training data from {failedFiles.length === 1 ? "it" : "them"}.
              </p>
              {failedFiles.map((f: any) => (
                <div key={f.id} className="text-xs border rounded-md px-3 py-2">
                  <span className="font-medium">{f.original_filename ?? "Uploaded file"}</span>
                  <span className="text-muted-foreground">: {f.parse_error}</span>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                The date/time above may not reflect when this activity actually happened — without a readable file,
                the session falls back to today's date. Try re-uploading the original file, or check it isn't
                corrupted or from an unsupported device/export.
              </p>
            </CardContent>
          </Card>
        )}

        {visibleSameDaySessions.length > 0 && (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="py-3 space-y-2">
              <p className="text-sm font-medium">
                {visibleSameDaySessions.length === 1
                  ? "Another uploaded session"
                  : `${visibleSameDaySessions.length} other uploaded sessions`}{" "}
                found for this athlete on the same day — could be a split-off warmup or cooldown from this same upload,
                or a genuine double day (e.g. separate AM/PM runs).
              </p>
              {visibleSameDaySessions.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between gap-3 text-sm border rounded-md px-3 py-2">
                  <div className="min-w-0">
                    <span className="font-medium">{s.title ?? "Untitled session"}</span>
                    <span className="text-muted-foreground ml-2">
                      {s.total_distance_m ? metersFmt(s.total_distance_m) : "—"}
                      {s.total_time_seconds ? ` · ${secToClock(s.total_time_seconds)}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={ignoringId === s.id}
                      onClick={() => handleIgnoreSameDay(s.id)}
                      title="This is a genuine double day, not a split-off upload — don't flag this pair again"
                    >
                      {ignoringId === s.id ? "Saving…" : "Ignore (double day)"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={merging}
                      onClick={() => setMergeTarget({ id: s.id, title: s.title ?? "Untitled session" })}
                    >
                      Merge into this session
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* ───────────────── Overview card: the four headline numbers + context ───────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Overview</CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">
            {(session.location || session.terrain || session.average_temp_c != null || session.wind_kph != null) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {session.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5 text-sky-400" />
                    {session.location}
                  </span>
                )}
                {session.terrain && (
                  <span className="flex items-center gap-1">
                    <Mountain className="h-3.5 w-3.5 text-emerald-500" />
                    {session.terrain.charAt(0).toUpperCase() + session.terrain.slice(1)}
                  </span>
                )}
                {session.average_temp_c != null && (
                  <span className="flex items-center gap-1">
                    <Thermometer className="h-3.5 w-3.5 text-orange-400" />
                    {session.average_temp_c}°C
                  </span>
                )}
                {session.wind_kph != null && (
                  <span className="flex items-center gap-1">
                    <Wind className="h-3.5 w-3.5 text-cyan-400" />
                    Wind {session.wind_kph} km/h
                  </span>
                )}
              </div>
            )}

            {/* Workout structure — one line per work step, e.g.
                "2 km" then "5 × 1km" + smaller "1 min Recovery (standing)"
                for a session with more than one distinct rep distance. */}
            {workoutStructures.length > 0 && (
              <div className="border rounded-lg px-3 py-2">
                <div className="text-xs text-muted-foreground">Workout</div>
                <div className="space-y-0.5">
                  {workoutStructures.map((ws, i) => (
                    <div key={i} className="text-lg font-semibold">
                      {ws.main}
                      {ws.recovery && (
                        <span className="text-sm font-normal text-muted-foreground"> + {ws.recovery}</span>
                      )}
                      {ws.target && (
                        <span className="ml-2 text-sm font-normal text-[var(--accent-red)]">{ws.target}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ✅ METRICS GRID */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                {/* Time */}
                <div className="border rounded-lg px-3 py-2">
                  <div className="text-xs text-muted-foreground">Total Time</div>
                  <div className="text-lg font-semibold tabular-nums">
                    {secToClock(session.total_time_seconds || 0)}
                  </div>
                  {(() => {
                    // Only worth a second line when there was a real stop —
                    // ordinary GPS/lap-boundary noise (a couple of seconds)
                    // shouldn't clutter every session with two near-identical
                    // numbers. 15s threshold keeps this to genuine pauses.
                    const movingS = (session as any).total_moving_time_seconds;
                    const totalS = session.total_time_seconds;
                    const hasRealStop = movingS != null && totalS != null && totalS - movingS >= 15;
                    return hasRealStop ? (
                      <div className="text-xs text-muted-foreground mt-0.5">Moving: {secToClock(movingS)}</div>
                    ) : null;
                  })()}
                </div>

                {/* Distance */}
                <div className="border rounded-lg px-3 py-2">
                  <div className="text-xs text-muted-foreground">
                    {session.day_type === "race" ? "Official Distance (editable)" : "GPS Distance"}
                  </div>

                  {/* ✅ MAIN VALUE */}
                  <div className="text-lg font-semibold tabular-nums">
                    {session.day_type === "race" && race ? (
                      <Input
                        type="number"
                        value={distanceInput}
                        className="h-7 text-sm"
                        onChange={(e) => {
                          setDistanceInput(e.target.value); // ✅ this makes it editable
                        }}
                        onBlur={async () => {
                          const val = Number(distanceInput) || 0;

                          await supabase.from("performances").update({ distance_m: val }).eq("id", race.id);

                          qc.invalidateQueries({ queryKey: ["race-by-session", sessionId] });
                        }}
                      />
                    ) : (
                      metersFmt(session.total_distance_m ?? 0)
                    )}
                  </div>

                  {/* No performances row for a race-marked session — this is
                      exactly the state that leaves this field stuck showing
                      the uneditable full GPS total (a previous creation
                      attempt errored, was interrupted, or predates the
                      work-only-distance fix). Surfaced clearly instead of
                      silently falling back, with a one-click way to fix it. */}
                  {session.day_type === "race" && !raceLoading && !race && (
                    <div className="text-xs text-amber-600 mt-1 space-y-1">
                      <div>
                        {raceError ? `Couldn't load race record: ${raceError.message}` : "No race record found for this session."}
                      </div>
                      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={createPerformanceRecord}>
                        Recreate race record
                      </Button>
                    </div>
                  )}

                  {/* ✅ ✅ GPS REFERENCE LINE (THIS IS THE FIX) */}
                  {session.day_type === "race" && (
                    <div className="text-xs text-muted-foreground mt-1">
                      GPS: {metersFmt(session.total_distance_m ?? 0)}
                    </div>
                  )}
                </div>

                {/* Pace */}
                <div className="border rounded-lg px-3 py-2">
                  <div className="text-xs text-muted-foreground">Total Avg Pace</div>
                  <div className="text-lg font-semibold tabular-nums">
                    {(() => {
                      // Prefer moving time (elapsed minus detected stops) so a
                      // mid-run pause doesn't inflate the displayed pace — falls
                      // back to raw elapsed time for sessions uploaded before
                      // this was tracked, which haven't been recomputed yet.
                      const timeForPace = (session as any).total_moving_time_seconds ?? session.total_time_seconds;
                      return timeForPace && (session.total_distance_m ?? 0) > 0
                        ? secToClock((timeForPace / (session.total_distance_m ?? 0)) * 1000)
                        : "—";
                    })()}
                  </div>
                </div>

                {/* RPE */}
                <div className="border rounded-lg px-3 py-2">
                  <div className="text-xs text-muted-foreground">RPE</div>
                  <div className="text-lg font-semibold tabular-nums">{session.rpe ?? "—"}</div>
                </div>
              </div>

              {/* Split pace — overall (above) can blend warmup/cooldown/work
                  paces together into something misleading. Shown only when
                  there's a real warmup/cooldown to distinguish from work. */}
              {((session as any).work_avg_pace_sec_per_km != null ||
                (session as any).easy_avg_pace_sec_per_km != null) && (
                <div className="grid grid-cols-2 gap-3 border-t pt-3">
                  {(session as any).work_avg_pace_sec_per_km != null && (
                    <div className="border rounded-lg px-3 py-2">
                      <div className="text-xs text-muted-foreground">Work pace</div>
                      <div className="text-lg font-semibold tabular-nums">
                        {secToClock((session as any).work_avg_pace_sec_per_km)}/km
                      </div>
                    </div>
                  )}
                  {(session as any).easy_avg_pace_sec_per_km != null && (
                    <div className="border rounded-lg px-3 py-2">
                      <div className="text-xs text-muted-foreground">Warm-up/Cool-down avg</div>
                      <div className="text-lg font-semibold tabular-nums">
                        {secToClock((session as any).easy_avg_pace_sec_per_km)}/km
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Split corrections — only surfaced when GPS reconstruction actually
                  flagged something (dropout/spike) it couldn't confidently resolve
                  on its own, or when this session already has saved corrections
                  from before (so existing overrides are never hidden). */}
              {(needsManualSplitCorrection || ((session.distance_adjustments as any[] | null) ?? []).length > 0) && (
                <div className="border-t pt-3 space-y-2">
                  <Label className="text-xs text-muted-foreground">Split corrections</Label>

                  {needsManualSplitCorrection && (
                    <p className="text-xs text-muted-foreground">
                      GPS reconstruction detected a dropout or spike it couldn't fully resolve automatically — use these
                      to manually adjust a specific split if needed.
                    </p>
                  )}

                  {((session.distance_adjustments as any[] | null) ?? []).map((adj: any, i: number) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={adj.split_km}
                        placeholder="Km"
                        className="w-16"
                        onChange={async (e) => {
                          const updated = [...((session.distance_adjustments as any[] | null) ?? [])];
                          updated[i].split_km = Number(e.target.value);

                          await supabase
                            .from("sessions")
                            .update({ distance_adjustments: updated })
                            .eq("id", session.id);

                          qc.invalidateQueries({ queryKey: ["session", sessionId] });
                        }}
                      />

                      <Input
                        type="number"
                        value={adj.meters}
                        placeholder="+m"
                        className="w-20"
                        onChange={async (e) => {
                          const updated = [...((session.distance_adjustments as any[] | null) ?? [])];
                          updated[i].meters = Number(e.target.value);

                          await supabase
                            .from("sessions")
                            .update({ distance_adjustments: updated })
                            .eq("id", session.id);

                          qc.invalidateQueries({ queryKey: ["session", sessionId] });
                        }}
                      />

                      <span className="text-xs text-muted-foreground">m</span>

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          const updated = ((session.distance_adjustments as any[] | null) ?? []).filter(
                            (_: any, idx: number) => idx !== i,
                          );

                          await supabase
                            .from("sessions")
                            .update({ distance_adjustments: updated })
                            .eq("id", session.id);

                          qc.invalidateQueries({ queryKey: ["session", sessionId] });
                        }}
                      >
                        ✕
                      </Button>
                    </div>
                  ))}

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const updated = [
                        ...((session.distance_adjustments as any[] | null) ?? []),
                        { split_km: 1, meters: 50 },
                      ];

                      await supabase.from("sessions").update({ distance_adjustments: updated }).eq("id", session.id);

                      qc.invalidateQueries({ queryKey: ["session", sessionId] });
                    }}
                  >
                    + Add correction
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        {session.notes && (
          <Card>
            <CardContent className="pt-4 text-sm">{session.notes}</CardContent>
          </Card>
        )}

        {(fileCount >= 3 || (session.day_type === "race" && !(session as any).race_step_id)) &&
          !(session as any).review_dismissed_at && (
            <Card className="border-blue-500/40 bg-blue-500/5">
              <CardContent className="py-3 text-sm flex items-start justify-between gap-3">
                <div>
                  <span className="font-medium">Review recommended: </span>
                  {fileCount >= 3
                    ? `This session combines ${fileCount} uploaded files — please check the Workout structure below to confirm warmup/work/cooldown are correctly assigned.`
                    : "This session is marked as a race but no block has been confirmed as the race yet."}{" "}
                  Use the dropdown on each block to fix any mislabeled segment, and{" "}
                  {session.day_type === "race" ? '"Mark as race" on the correct block, ' : ""}
                  then "↻ Recompute classification" above if you want the auto-split re-run from scratch.
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0"
                  onClick={async () => {
                    const { error } = await supabase
                      .from("sessions")
                      .update({ review_dismissed_at: new Date().toISOString() } as any)
                      .eq("id", sessionId);
                    if (error) {
                      toast.error(error.message);
                      return;
                    }
                    toast.success("Marked as reviewed");
                    qc.invalidateQueries({ queryKey: ["session", sessionId] });
                  }}
                >
                  ✓ Reviewed
                </Button>
              </CardContent>
            </Card>
          )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">Workout structure</h2>
            <div className="flex items-center gap-2">
              {!structureEditMode && (
                <Button size="sm" variant="ghost" onClick={() => setAllOpen((v) => !v)}>
                  {allOpen ? "Collapse all" : "Expand all"}
                </Button>
              )}
              <Button
                size="sm"
                variant={structureEditMode ? "default" : "outline"}
                disabled={(steps ?? []).length < 2}
                onClick={() => setStructureEditMode((v) => !v)}
              >
                {structureEditMode ? "Done reordering" : "Reorder blocks"}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            {stepIds.length > 0 && resultsLoading && !results ? (
              <Card>
                <CardContent className="pt-4 text-sm text-muted-foreground">Loading session data…</CardContent>
              </Card>
            ) : structureEditMode ? (
              <WorkoutStructureOrderEditor session={session} steps={steps ?? []} qc={qc} />
            ) : (
              (steps ?? []).map((step: any) => (
                <StepBlock
                  key={step.id}
                  session={session}
                  step={step}
                  zoneProfile={zoneProfile}
                  results={(results ?? []).filter((r: any) => r.step_id === step.id)}
                  fuelEvents={(fuelEvents ?? []).filter((f: any) => f.step_id === step.id)}
                  forceOpen={allOpen}
                />
              ))
            )}
          </div>
        </div>
        {/* Daily Log is the primary place feedback (RPE, feel, reflection) gets
            entered now — this editable card is only a fallback for sessions
            completed directly from here (a coach logging on an athlete's
            behalf, or a planned session with no Daily Log entry at all).
            Once a session is complete, the read-only card below takes over
            so there's exactly one place to edit, not two live copies. */}
        {!session.completed_at && (
          <SessionSummary
            session={session}
            results={results ?? []}
            onSaved={() => invalidateSession(qc, sessionId, session.athlete_id)}
            onCompleted={() => setInsightOpen(true)}
          />
        )}

        {isCoach && (
          <AttendanceCard
            sessionId={sessionId}
            athleteId={session.athlete_id}
            athleteName={session.athletes?.name ?? "Athlete"}
          />
        )}

        <FuelingPanel session={session} />
        <GearPanel session={session} />
      </div>

      <Dialog open={!!mergeTarget} onOpenChange={(open) => !open && setMergeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge "{mergeTarget?.title}" into this session?</DialogTitle>
            <DialogDescription>
              This permanently deletes "{mergeTarget?.title}" — its GPS trace, steps, results, insights, and any race
              record — and moves its files into this session instead. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={merging} onClick={() => mergeTarget && handleMerge(mergeTarget.id)}>
              {merging ? "Merging…" : "Yes, merge and delete the other session"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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



// Default field values for a newly-added block, mirroring defaultStep() in
// sessions.new.tsx — kept in sync manually since this page builds one row
// directly (via insert) rather than staging drafts client-side like the
// New Session builder does.
function defaultFieldsForKind(kind: string) {
  if (kind === "recovery") {
    return { reps: 1, set_count: 1, recovery_mode: "jog", recovery_target_kind: "time", recovery_target_seconds: 90 };
  }
  if (kind === "work") {
    return {
      reps: 6,
      set_count: 1,
      target_kind: "distance",
      target_distance_m: 400,
      recovery_between_reps_seconds: 90,
      recovery_between_reps_mode: "jog",
      recovery_between_reps_target_kind: "time",
      recovery_between_sets_seconds: 180,
      recovery_between_sets_mode: "walk",
      recovery_between_sets_target_kind: "time",
    };
  }
  if (kind === "strides") {
    return { reps: 4, set_count: 1, target_kind: "distance", target_distance_m: 80 };
  }
  // warmup / cooldown
  return { reps: 1, set_count: 1, target_kind: "time", target_time_seconds: 600 };
}

// Builds a full `steps` insert row for a newly-added block, matching the
// exact column shape sessions.new.tsx writes on session creation — so a
// manually-added block on an existing session satisfies the same
// constraints as one created through the builder.
function buildNewStepRow(sessionId: string, kind: string, stepOrder: number) {
  const d: any = defaultFieldsForKind(kind);
  const setCount = kind === "work" ? Math.max(1, d.set_count ?? 1) : 1;
  return {
    session_id: sessionId,
    step_order: stepOrder,
    kind,
    reps: d.reps,
    set_count: setCount,
    target_kind: d.target_kind ?? null,
    target_distance_m: d.target_distance_m ?? null,
    target_time_seconds: d.target_time_seconds ?? null,
    target_pace_sec_per_km: null,
    is_ladder: false,
    counts_toward_distance: true,
    recovery_between_reps_seconds: kind === "work" ? (d.recovery_between_reps_seconds ?? null) : null,
    recovery_between_reps_mode: kind === "work" ? (d.recovery_between_reps_mode ?? null) : null,
    recovery_between_reps_target_kind: kind === "work" ? (d.recovery_between_reps_target_kind ?? "time") : "time",
    recovery_between_reps_distance_m: kind === "work" ? (d.recovery_between_reps_distance_m ?? null) : null,
    recovery_between_sets_seconds: kind === "work" && setCount > 1 ? (d.recovery_between_sets_seconds ?? null) : null,
    recovery_between_sets_mode: kind === "work" && setCount > 1 ? (d.recovery_between_sets_mode ?? null) : null,
    recovery_between_sets_target_kind:
      kind === "work" && setCount > 1 ? (d.recovery_between_sets_target_kind ?? "time") : "time",
    recovery_between_sets_distance_m: kind === "work" && setCount > 1 ? (d.recovery_between_sets_distance_m ?? null) : null,
    recovery_mode: d.recovery_mode ?? null,
    recovery_target_kind: d.recovery_target_kind ?? null,
    recovery_target_seconds: d.recovery_target_seconds ?? null,
    recovery_target_distance_m: d.recovery_target_distance_m ?? null,
    notes: null,
  };
}

const BLOCK_KIND_LABEL: Record<string, string> = {
  warmup: "Warmup",
  work: "Work block",
  recovery: "Recovery",
  cooldown: "Cooldown",
  strides: "Strides / Run-throughs",
};

// Drag-and-drop editing of the whole Workout structure — warmup, work,
// recovery, and cooldown blocks can all move relative to each other (unlike
// the New Session builder, which anchors warmup/cooldown in place; a coach
// editing an already-uploaded/parsed session may need to fix a genuinely
// mislabeled or misordered block, e.g. a cooldown that got split off and
// merged back in the wrong spot). Also supports adding a new block, deleting
// one, and reassigning a block's kind (e.g. turning a work block into
// Strides) — all from this same view, so a coach doesn't need to bounce
// between a reorder mode and the normal expanded view for structural edits.
// Reordering/reassigning only ever rewrites `step_order`/`kind` — never
// results — so the rest of the Overview (pace/distance aggregates, Workout
// summary) simply re-reads once the steps query is invalidated; nothing
// needs recomputing there. Adding/deleting a block is the one case that can
// change aggregates (a deleted block's results go with it), so both call
// the same session-level query invalidations the rest of the page uses.
function WorkoutStructureOrderEditor({ session, steps, qc }: { session: any; steps: any[]; qc: ReturnType<typeof useQueryClient> }) {
  const [localSteps, setLocalSteps] = useState(steps);
  const [saving, setSaving] = useState(false);
  const [blockToDelete, setBlockToDelete] = useState<any | null>(null);

  useEffect(() => {
    setLocalSteps(steps);
  }, [steps]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function invalidateStructure() {
    qc.invalidateQueries({ queryKey: ["steps", session.id] });
    qc.invalidateQueries({ queryKey: ["overview-work-steps", session.id] });
    // Prefix match — "results" queries are keyed with a dynamic step-id
    // join, so this invalidates all of them for this session regardless
    // of which exact step-id set was last fetched.
    qc.invalidateQueries({ queryKey: ["results", session.id] });
  }

  async function persistOrder(next: any[]) {
    setSaving(true);
    const results = await Promise.all(
      next.map((s, i) => supabase.from("steps").update({ step_order: i + 1 }).eq("id", s.id)),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      toast.error(failed.error.message);
      setLocalSteps(steps); // revert to last known-good order
    } else {
      invalidateStructure();
      toast.success("Workout order updated");
    }
    setSaving(false);
  }

  function handleDragEnd(ev: DragEndEvent) {
    const { active, over } = ev;
    if (!over || active.id === over.id) return;
    const ids = localSteps.map((s) => s.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    const next = arrayMove(localSteps, from, to);
    setLocalSteps(next);
    persistOrder(next);
  }

  async function addBlock(kind: string) {
    setSaving(true);
    const nextOrder = localSteps.reduce((max, s) => Math.max(max, s.step_order ?? 0), 0) + 1;
    const row = buildNewStepRow(session.id, kind, nextOrder);
    const { error } = await supabase.from("steps").insert(row as any);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${BLOCK_KIND_LABEL[kind]} added at the end — drag it into position, then set its reps/targets below`);
    invalidateStructure();
  }

  async function reassignKind(step: any, newKind: string) {
    if (newKind === step.kind) return;
    setSaving(true);
    const { error } = await supabase.from("steps").update({ kind: newKind } as any).eq("id", step.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Reassigned to ${BLOCK_KIND_LABEL[newKind] ?? newKind}`);
    invalidateStructure();
  }

  async function confirmDelete() {
    if (!blockToDelete) return;
    setSaving(true);
    // Results are children of the step — clear them first so the delete
    // never fails on a foreign-key reference, regardless of whether the
    // DB itself cascades.
    const { error: resultsErr } = await supabase.from("interval_results").delete().eq("step_id", blockToDelete.id);
    if (resultsErr) {
      toast.error(resultsErr.message);
      setSaving(false);
      return;
    }
    const { error } = await supabase.from("steps").delete().eq("id", blockToDelete.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Block deleted");
    setBlockToDelete(null);
    invalidateStructure();
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Drag any block — warmup, work, recovery, or cooldown — to reorder the session. Use the dropdown to change a
        block's type, or the buttons below to add or remove a block. Changes save immediately.
      </p>

      <div className="flex flex-wrap gap-2 pb-1 border-b">
        {(["warmup", "strides", "work", "recovery", "cooldown"] as const).map((kind) => (
          <Button key={kind} variant="outline" size="sm" disabled={saving} onClick={() => addBlock(kind)}>
            <span className={`inline-block h-2 w-2 rounded-full mr-1.5 ${stepKindBarClass(kind)}`} />
            <Plus className="h-3 w-3 mr-1" />
            {BLOCK_KIND_LABEL[kind]}
          </Button>
        ))}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={localSteps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {localSteps.map((step, i) => (
            <SortableStructureRow
              key={step.id}
              id={step.id}
              step={step}
              position={i + 1}
              disabled={saving}
              onReassignKind={(newKind) => reassignKind(step, newKind)}
              onRequestDelete={() => setBlockToDelete(step)}
            />
          ))}
        </SortableContext>
      </DndContext>

      <Dialog open={!!blockToDelete} onOpenChange={(open) => !open && setBlockToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this block?</DialogTitle>
            <DialogDescription>
              This permanently deletes the "{blockToDelete ? BLOCK_KIND_LABEL[blockToDelete.kind] : ""}" block and any
              recorded reps/results for it. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockToDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={saving} onClick={confirmDelete}>
              {saving ? "Deleting…" : "Yes, delete this block"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SortableStructureRow({
  id,
  step,
  position,
  disabled,
  onReassignKind,
  onRequestDelete,
}: {
  id: string;
  step: any;
  position: number;
  disabled?: boolean;
  onReassignKind: (newKind: string) => void;
  onRequestDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="flex items-stretch gap-3 border rounded-md bg-background overflow-hidden">
      <div className={`w-1.5 shrink-0 ${stepKindBarClass(step.kind)}`} />
      <div className="flex-1 min-w-0 px-3 py-2.5 flex items-center gap-3">
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={disabled}
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="text-sm text-muted-foreground w-5 shrink-0 tabular-nums">{position}.</span>
        <span className={`text-sm font-medium flex-1 ${stepKindTextClass(step.kind)}`}>{stepStructureSummary(step)}</span>

        <Select value={step.kind} onValueChange={onReassignKind}>
          <SelectTrigger className="h-7 w-[110px] text-xs shrink-0" disabled={disabled}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="warmup">Warmup</SelectItem>
            <SelectItem value="work">Work</SelectItem>
            <SelectItem value="recovery">Recovery</SelectItem>
            <SelectItem value="cooldown">Cooldown</SelectItem>
            <SelectItem value="strides">Strides</SelectItem>
          </SelectContent>
        </Select>

        <Button size="sm" variant="ghost" className="shrink-0" disabled={disabled} onClick={onRequestDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// Short one-line label for a step in the reorder view, e.g.
// "Work · 6×400m" or "Cooldown". Mirrors the summary already shown in
// StepBlock's collapsed header, kept separate since the reorder row has
// no expand/collapse state of its own.
function stepStructureSummary(step: any): string {
  const kindLabel = step.kind === "recovery" ? "Recovery" : step.kind.charAt(0).toUpperCase() + step.kind.slice(1);
  const setCount = Math.max(1, step.set_count ?? 1);

  if (step.kind === "work" && step.target_kind === "distance" && step.target_distance_m) {
    return `${kindLabel} · ${setCount > 1 ? `${setCount}×` : ""}${step.reps}×${metersFmt(roundDistanceForDisplay(step.target_distance_m))}`;
  }
  if (step.kind === "work" && step.target_kind === "time" && step.target_time_seconds) {
    return `${kindLabel} · ${step.reps}×${secToClock(step.target_time_seconds)}`;
  }
  // Strides intentionally show no "reps × distance" suffix here either —
  // see the matching note in StepBlock's header above.
  return kindLabel;
}


function StepBlock({
  session,
  step,
  zoneProfile,
  results,
  fuelEvents,
  forceOpen,
}: {
  session: any;
  step: any;
  zoneProfile?: any;
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

    await recomputeSessionAggregatesFromReps();
    await recomputeStepTargetFromReps();

    invalidateSession(qc, session.id, session.athlete_id);
  }

  // Keeps this step's own target_distance_m/target_time_seconds — the
  // numbers the block header ("Work · 5×1.60 Km") is built from — in sync
  // with what was actually entered for its reps. Previously only the
  // session-level aggregates got recomputed after a rep edit; the block
  // header itself kept showing whatever the original plan/template said,
  // so e.g. correcting a treadmill session's rep distances never updated
  // the "5×1.60 Km" label above them. Only touches whichever target_kind
  // the step already uses (distance vs time) — it never changes the kind
  // itself, just keeps the displayed number honest. Uses the average of
  // whatever reps have a value, so a single quick edit doesn't skew the
  // label if only one rep out of several was corrected.
  async function recomputeStepTargetFromReps() {
    if (step.kind !== "work" && step.kind !== "strides") return;
    if (step.target_kind !== "distance" && step.target_kind !== "time") return;

    const { data: reps } = await supabase
      .from("interval_results")
      .select("actual_distance_m, actual_time_seconds")
      .eq("step_id", step.id);

    if (!reps || reps.length === 0) return;

    if (step.target_kind === "distance") {
      const values = reps.map((r: any) => Number(r.actual_distance_m)).filter((v: number) => Number.isFinite(v) && v > 0);
      if (values.length === 0) return;
      const avg = Math.round(values.reduce((a: number, b: number) => a + b, 0) / values.length);
      if (avg === step.target_distance_m) return;
      const { error } = await supabase.from("steps").update({ target_distance_m: avg } as any).eq("id", step.id);
      if (error) console.error("Failed to recompute step target distance:", error.message);
    } else {
      const values = reps.map((r: any) => Number(r.actual_time_seconds)).filter((v: number) => Number.isFinite(v) && v > 0);
      if (values.length === 0) return;
      const avg = Math.round(values.reduce((a: number, b: number) => a + b, 0) / values.length);
      if (avg === step.target_time_seconds) return;
      const { error } = await supabase.from("steps").update({ target_time_seconds: avg } as any).eq("id", step.id);
      if (error) console.error("Failed to recompute step target time:", error.message);
    }
  }

  // Rolls up interval_results across every step in this session into the
  // session-level fields the Overview card actually reads. Editing a rep's
  // Time/Dist previously only touched interval_results — Work pace,
  // Warm-up/Cool-down avg, and (for manually-created sessions) GPS
  // Distance all read straight from the `sessions` row and never picked up
  // a manual edit until this ran.
  //
  // GPS-derived total_distance_m/total_time_seconds are left untouched for
  // real FIT/GPX uploads (source === 'fit_import') — those represent the
  // actual recorded track, not a coach's manual entry, and a manual rep
  // tweak should never silently overwrite real GPS data. For
  // manually-created sessions (no GPS track at all) those totals are
  // backfilled from the reps since there's no other source of truth.
  async function recomputeSessionAggregatesFromReps() {
    const { data: steps } = await supabase.from("steps").select("id, kind").eq("session_id", session.id);
    if (!steps || steps.length === 0) return;

    const stepIds = steps.map((s: any) => s.id);
    const kindByStepId = new Map(steps.map((s: any) => [s.id, s.kind]));

    const { data: allResults } = await supabase
      .from("interval_results")
      .select("step_id, actual_distance_m, actual_time_seconds")
      .in("step_id", stepIds);

    let workDistance = 0;
    let workTime = 0;
    let easyDistance = 0;
    let easyTime = 0;
    let totalDistance = 0;
    let totalTime = 0;

    for (const r of allResults ?? []) {
      const kind = kindByStepId.get((r as any).step_id);
      const d = Number((r as any).actual_distance_m) || 0;
      const t = Number((r as any).actual_time_seconds) || 0;
      totalDistance += d;
      totalTime += t;
      if (kind === "work" || kind === "strides") {
        workDistance += d;
        workTime += t;
      } else if (kind === "warmup" || kind === "cooldown") {
        easyDistance += d;
        easyTime += t;
      }
    }

    const sessionPatch: any = {
      work_distance_m: workDistance || null,
      work_time_s: workTime || null,
      work_avg_pace_sec_per_km: workDistance > 0 && workTime > 0 ? (workTime / workDistance) * 1000 : null,
      easy_avg_pace_sec_per_km: easyDistance > 0 && easyTime > 0 ? (easyTime / easyDistance) * 1000 : null,
    };

    if (session.source !== "fit_import") {
      sessionPatch.total_distance_m = totalDistance || null;
      sessionPatch.total_time_seconds = totalTime || null;
    }

    const { error: aggErr } = await supabase.from("sessions").update(sessionPatch).eq("id", session.id);
    if (aggErr) {
      console.error("Failed to recompute session aggregates from reps:", aggErr.message);
    }
  }

  const isMarkedAsRace = session.race_step_id === step.id;

  async function reassignKind(newKind: string) {
    if (newKind === step.kind) return;
    const { error } = await supabase
      .from("steps")
      .update({ kind: newKind } as any)
      .eq("id", step.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Reassigned to ${newKind}`);
    invalidateSession(qc, session.id, session.athlete_id);
  }

  async function markAsRace() {
    // Build the race's actual distance/time from this step's own recorded
    // reps, not the whole session — so a race with an attached warmup or
    // cooldown never gets its distance/time diluted by them.
    const totalDistance = results.reduce((sum, r) => sum + (Number(r.actual_distance_m) || 0), 0);
    const totalTime = results.reduce((sum, r) => sum + (Number(r.actual_time_seconds) || 0), 0);

    if (totalDistance <= 0 || totalTime <= 0) {
      toast.error("This block has no recorded distance/time yet — add results before marking it as the race.");
      return;
    }

    const { data: updatedSession, error: sessErr } = await supabase
      .from("sessions")
      .update({ day_type: "race", race_step_id: step.id } as any)
      .eq("id", session.id)
      .select()
      .single();

    if (sessErr) {
      toast.error(sessErr.message);
      return;
    }

    qc.setQueryData(["session", session.id], updatedSession);

    // Replace any existing performance for this session with this step's data
    await (supabase.from("performances") as any).delete().eq("session_id", session.id);

    const { error: perfErr } = await (supabase.from("performances") as any).insert({
      athlete_id: session.athlete_id,
      performance_date: session.session_date,
      distance_m: Math.round(totalDistance),
      time_seconds: totalTime,
      event_name: session.title || null,
      notes: session.notes || null,
      session_id: session.id,
      // is_pb omitted — recomputed by trigger, see createPerformanceRecord above.
      context: "race",
    });

    if (perfErr) {
      toast.error(perfErr.message);
      return;
    }

    toast.success("Marked as the race 🏁");
    qc.invalidateQueries({ queryKey: ["session", session.id] });
    qc.invalidateQueries({ queryKey: ["race-by-session", session.id] });
    qc.invalidateQueries({ queryKey: ["races", session.athlete_id] });
    qc.invalidateQueries({ queryKey: ["my-pbs", session.athlete_id] });
  }

  async function unmarkAsRace() {
    const { data: updatedSession, error } = await supabase
      .from("sessions")
      .update({ day_type: "training", race_step_id: null } as any)
      .eq("id", session.id)
      .select()
      .single();

    if (error) {
      toast.error(error.message);
      return;
    }

    await (supabase.from("performances") as any).delete().eq("session_id", session.id);

    qc.setQueryData(["session", session.id], updatedSession);
    toast("Race unmarked");
    qc.invalidateQueries({ queryKey: ["session", session.id] });
    qc.invalidateQueries({ queryKey: ["race-by-session", session.id] });
    qc.invalidateQueries({ queryKey: ["races", session.athlete_id] });
  }

  return (
    <Card>
      {/* ✅ HEADER */}
      <CardHeader className="cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center justify-between bg-muted/40 rounded px-2 py-1">
          <CardTitle className="text-base capitalize flex items-center gap-2">
            {isMarkedAsRace && <span title="This block is marked as the race">🏁</span>}
            {step.kind === "recovery" ? "Recovery" : step.kind}

            {isWork &&
              step.target_kind === "distance" &&
              ` · ${setCount > 1 ? `${setCount}×` : ""}${step.reps}×${metersFmt(roundDistanceForDisplay(step.target_distance_m))}`}

            {isWork && step.target_kind === "time" && ` · ${step.reps}×${secToClock(step.target_time_seconds)}`}

            {/* Resolved workout target (Phase 3) — "95% thr · 4:07–4:20/km",
                "Z3 · 4:30–5:00/km", "RPE 7/10". Open steps show nothing.
                normal-case overrides the CardTitle's capitalize so labels
                like "bpm" and "thr" don't get mangled. */}
            {(() => {
              const t = resolveStepTarget(step, zoneProfile);
              if (t.mode === "open") return null;
              return (
                <span
                  className="text-sm font-normal normal-case text-[var(--accent-red)]"
                  title={t.detail ?? undefined}
                >
                  {t.label}
                </span>
              );
            })()}

            {/* Strides intentionally show no "reps × distance" suffix — unlike
                a work block's reps, individual strides commonly vary in
                distance from each other (a coach eyeballing 80-100m pickups,
                not a fixed track distance), so a single uniform figure here
                would misrepresent the block. */}
          </CardTitle>

          <div className="flex items-center gap-2">
            <Select value={step.kind} onValueChange={reassignKind}>
              <SelectTrigger className="h-7 w-[110px] text-xs" onClick={(e) => e.stopPropagation()}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="warmup">Warmup</SelectItem>
                <SelectItem value="work">Work</SelectItem>
                <SelectItem value="recovery">Recovery</SelectItem>
                <SelectItem value="cooldown">Cooldown</SelectItem>
                <SelectItem value="strides">Strides</SelectItem>
              </SelectContent>
            </Select>
            {/* Set/fix a target here regardless of how this session landed on
                the calendar (template apply, plan assignment, or a builder
                save that skipped it) — the one place every creation path
                converges. Only while planned; a completed step's block is
                for actuals, not the prescription. */}
            {(isWork || isStrides) && !session.completed_at && (
              <WorkTargetEditor
                step={step}
                onSaved={() => qc.invalidateQueries({ queryKey: ["steps", session.id] })}
              />
            )}
            {isWork && (
              <Button
                size="sm"
                variant={isMarkedAsRace ? "destructive" : "outline"}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isMarkedAsRace) {
                    unmarkAsRace();
                  } else {
                    markAsRace();
                  }
                }}
              >
                {isMarkedAsRace ? "Unmark race" : "🏁 Mark as race"}
              </Button>
            )}
            <div className="text-sm text-muted-foreground">{open ? "▼" : "▶"}</div>
          </div>
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
                            <div key={`${setN}-${rep}`}>
                              <RepRow step={step} rep={rep} result={r} onSave={(p) => saveRep(setN, rep, p)} />
                              {step.reps > 1 && rep < reps.length && <RecoveryBetweenReps step={step} session={session} />}
                            </div>
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
    setDist(result?.actual_distance_m != null ? Math.round(Number(result.actual_distance_m)) : "");
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
      actual_distance_m: dist === "" ? null : Math.round(Number(dist)),
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
          <Label className="text-xs">Dist (m)</Label>

          <Input type="number" step="1" value={dist} onChange={(e) => setDist(e.target.value)} onBlur={commit} />
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

// A small editable divider shown between reps in a work/strides step,
// surfacing the "recovery between reps" target that previously only
// appeared read-only in the collapsed header summary. This is a single
// step-level target (recovery_between_reps_seconds/_distance_m/_mode),
// not a per-rep result — editing any one instance updates the same
// underlying value that applies to every recovery in this step, which is
// why the same summary repeats between each pair of reps.
function RecoveryBetweenReps({ step, session }: { step: any; session: any }) {
  const qc = useQueryClient();
  const isDistanceTarget = step.recovery_between_reps_target_kind === "distance";

  const [editing, setEditing] = useState(false);
  const [timeText, setTimeText] = useState(secToClock(step.recovery_between_reps_seconds || 0));
  const [distanceText, setDistanceText] = useState<string | number>(step.recovery_between_reps_distance_m ?? "");
  const [mode, setMode] = useState<string>(step.recovery_between_reps_mode ?? "standing");

  useEffect(() => {
    setTimeText(secToClock(step.recovery_between_reps_seconds || 0));
    setDistanceText(step.recovery_between_reps_distance_m ?? "");
    setMode(step.recovery_between_reps_mode ?? "standing");
  }, [step.id, step.recovery_between_reps_seconds, step.recovery_between_reps_distance_m, step.recovery_between_reps_mode]);

  async function commit() {
    const patch: any = { recovery_between_reps_mode: mode || null };
    if (isDistanceTarget) {
      patch.recovery_between_reps_distance_m = distanceText === "" ? null : Number(distanceText);
    } else {
      patch.recovery_between_reps_seconds = clockToSec(timeText as any) || null;
    }

    const { error } = await supabase.from("steps").update(patch).eq("id", step.id);
    if (error) {
      toast.error(`Recovery save failed: ${error.message}`);
      return;
    }
    setEditing(false);
    invalidateSession(qc, session.id, session.athlete_id);
  }

  const summary =
    isDistanceTarget && Number(distanceText) > 0
      ? `${metersFmt(roundDistanceForDisplay(Number(distanceText)))} Recovery${mode ? ` (${mode})` : ""}`
      : (clockToSec(timeText as any) ?? 0) > 0
        ? `${formatRecoveryDuration(roundRecoverySeconds(clockToSec(timeText as any) ?? 0))} Recovery${mode ? ` (${mode})` : ""}`
        : "Recovery (not set)";

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="w-full text-left text-xs italic text-muted-foreground px-2 py-1 my-0.5 rounded hover:bg-accent/40 hover:text-foreground"
        title="Applies to every recovery between reps in this step — click to edit"
      >
        ↓ {summary}
      </button>
    );
  }

  return (
    <div className="flex items-end gap-2 px-2 py-1.5 my-0.5 bg-muted/30 rounded">
      {isDistanceTarget ? (
        <div>
          <Label className="text-xs">Recovery dist (m)</Label>
          <Input
            type="number"
            step="1"
            className="h-7 w-24 text-xs"
            value={distanceText}
            onChange={(e) => setDistanceText(e.target.value)}
          />
        </div>
      ) : (
        <div>
          <Label className="text-xs">Recovery (mm:ss)</Label>
          <Input className="h-7 w-20 text-xs" value={timeText} onChange={(e) => setTimeText(e.target.value)} />
        </div>
      )}
      <div>
        <Label className="text-xs">Mode</Label>
        <Input className="h-7 w-28 text-xs" value={mode} onChange={(e) => setMode(e.target.value)} />
      </div>
      <Button size="sm" className="h-7" onClick={commit}>
        Save
      </Button>
      <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(false)}>
        Cancel
      </Button>
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
  const [carbs, setCarbs] = useState<string>(session.fueling_carbs_g != null ? String(session.fueling_carbs_g) : "");
  const [fluid, setFluid] = useState<string>(session.fueling_fluid_ml != null ? String(session.fueling_fluid_ml) : "");
  const [sodium, setSodium] = useState<string>(session.fueling_sodium_mg != null ? String(session.fueling_sodium_mg) : "");
  // Re-sync whenever the underlying session row changes — keyed on
  // session.id (not just the individual fields) so this resets correctly
  // even when navigating session-to-session via the < > links reuses this
  // component instance instead of remounting it, same class of stale-
  // state bug already fixed elsewhere on this page for that reason.
  useEffect(() => {
    setNotes(session.fueling_notes ?? "");
    setCarbs(session.fueling_carbs_g != null ? String(session.fueling_carbs_g) : "");
    setFluid(session.fueling_fluid_ml != null ? String(session.fueling_fluid_ml) : "");
    setSodium(session.fueling_sodium_mg != null ? String(session.fueling_sodium_mg) : "");
  }, [session.id, session.fueling_notes, session.fueling_carbs_g, session.fueling_fluid_ml, session.fueling_sodium_mg]);

  async function save() {
    const { error } = await supabase
      .from("sessions")
      .update({
        fueling_notes: notes || null,
        fueling_carbs_g: carbs === "" ? null : Number(carbs),
        fueling_fluid_ml: fluid === "" ? null : Number(fluid),
        fueling_sodium_mg: sodium === "" ? null : Number(sodium),
      })
      .eq("id", session.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Fueling saved");
      qc.invalidateQueries({ queryKey: ["session", session.id] });
    }
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Fueling</CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label className="text-xs flex items-center gap-1">
              <Flame className="h-3 w-3" /> Carbs (g)
            </Label>
            <Input
              type="number"
              step="0.1"
              value={carbs}
              onChange={(e) => setCarbs(e.target.value)}
              placeholder="60"
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-xs flex items-center gap-1">
              <Droplet className="h-3 w-3" /> Fluid (ml)
            </Label>
            <Input
              type="number"
              value={fluid}
              onChange={(e) => setFluid(e.target.value)}
              placeholder="500"
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">Sodium (mg)</Label>
            <Input
              type="number"
              value={sodium}
              onChange={(e) => setSodium(e.target.value)}
              placeholder="300"
              className="h-8 text-sm"
            />
          </div>
        </div>

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

// Assigns gear (shoes/bike/etc, from the Locker's Gear page) to this
// session — the other half of "assign from the session page" alongside
// the Gear page's own retroactive linker. Multi-select toggle buttons,
// same interaction pattern the Daily Log's recovery-modalities tags
// already use, since a session can reasonably have more than one item
// linked (e.g. a treadmill run: both the treadmill and the shoes worn).
function GearPanel({ session }: { session: any }) {
  const qc = useQueryClient();
  const athleteId = session.athlete_id as string;
  const sessionId = session.id as string;

  const { data: gearItems } = useQuery({
    queryKey: ["gear-items-for-session", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gear_items")
        .select("id, gear_type, shoe_category, is_spike, brand, model, nickname")
        .eq("athlete_id", athleteId)
        .eq("is_retired", false)
        .order("gear_type")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: linkedIds } = useQuery({
    queryKey: ["session-gear-links", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("session_gear").select("gear_id").eq("session_id", sessionId);
      if (error) throw error;
      return new Set((data ?? []).map((r: any) => r.gear_id as string));
    },
  });

  const [selected, setSelected] = useState<Set<string> | null>(null);

  // Re-sync from the DB whenever we land on a (possibly different)
  // session or its links load/change — same stale-state guard used
  // throughout this page for components that don't remount between
  // sessions.
  useEffect(() => {
    if (linkedIds) setSelected(new Set(linkedIds));
  }, [sessionId, linkedIds]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (!selected) return;
    const before = linkedIds ?? new Set<string>();
    const toAdd = [...selected].filter((id) => !before.has(id));
    const toRemove = [...before].filter((id) => !selected.has(id));

    if (toAdd.length > 0) {
      const { error } = await supabase
        .from("session_gear")
        .insert(toAdd.map((gear_id) => ({ session_id: sessionId, gear_id, athlete_id: athleteId })) as any);
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    if (toRemove.length > 0) {
      const { error } = await supabase.from("session_gear").delete().eq("session_id", sessionId).in("gear_id", toRemove);
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    toast.success("Gear updated");
    qc.invalidateQueries({ queryKey: ["session-gear-links", sessionId] });
    qc.invalidateQueries({ queryKey: ["gear-usage", athleteId] });
    qc.invalidateQueries({ queryKey: ["gear-links"] });
  }

  if (!gearItems || gearItems.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Gear</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No gear added yet — add shoes, a bike, or other kit on the{" "}
            <Link to="/app/gear" className="underline">
              Gear
            </Link>{" "}
            page first.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Gear used</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {gearItems.map((g) => {
            const isSelected = selected?.has(g.id) ?? false;
            const label = g.nickname || `${g.brand} ${g.model}`;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => toggle(g.id)}
                className={`px-2.5 py-1 text-xs rounded-md border ${
                  isSelected
                    ? "bg-[var(--accent-red)] text-white border-[var(--accent-red)]"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
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
  const qc = useQueryClient();
  const [rpe, setRpe] = useState<number>(5);
  // Re-sync whenever the underlying session row changes (after server-side recompute).
  useEffect(() => {
    setRpe(session.rpe ?? 5);
  }, [session.rpe]);

  // Feel (Very Weak..Very Strong faces) lives on session_insights, not
  // sessions — same field the post-session reflection modal already saves
  // to, so however an athlete answers "how did you feel" (here or in that
  // popup) both write to and read from one place.
  const { data: insightForFeel } = useQuery({
    queryKey: ["session-feel", session.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("session_insights")
        .select("feel_score")
        .eq("session_id", session.id)
        .maybeSingle();
      return (data as any) ?? null;
    },
  });
  const [feel, setFeel] = useState<number | null>(null);
  // Keyed on session.id (not just the query result) so this resets correctly
  // even when navigating session-to-session via the < > links reuses this
  // component instance instead of remounting it — the same class of stale-
  // state bug already fixed elsewhere for exactly this reason.
  useEffect(() => {
    setFeel(insightForFeel?.feel_score ?? null);
  }, [session.id, insightForFeel]);

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

    const [sessionRes, insightRes] = await Promise.all([
      supabase
        .from("sessions")
        .update({
          rpe,
          ...(wasAlreadyComplete ? {} : { completed_at: new Date().toISOString() }),
        })
        .eq("id", session.id),
      feel != null
        ? supabase
            .from("session_insights")
            .upsert({ session_id: session.id, athlete_id: session.athlete_id, feel_score: feel } as any, {
              onConflict: "session_id",
            })
        : Promise.resolve({ error: null }),
    ]);

    if (sessionRes.error || insightRes.error) {
      toast.error(sessionRes.error?.message ?? insightRes.error?.message ?? "Save failed");
    } else {
      toast.success(wasAlreadyComplete ? "Session updated" : "Session marked complete");
      qc.invalidateQueries({ queryKey: ["session-feel", session.id] });
      onSaved();
      if (!wasAlreadyComplete) onCompleted?.();
    }
  }

  // Backdated sessions (e.g. added to the calendar for a past date) still
  // land here needing RPE + feel before they can be marked done, which is
  // unnecessary friction when there's simply no reflection to give — this
  // skips straight to completed_at with no RPE/feel written, and does NOT
  // fire onCompleted, so it never chains into the "How did that session
  // feel?" follow-up modal either.
  async function completeWithoutReflection() {
    const wasAlreadyComplete = !!session.completed_at;
    if (wasAlreadyComplete) return;

    const { error } = await supabase
      .from("sessions")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", session.id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("No session reflection completed");
      onSaved();
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Session feedback</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <Label className="text-xs">RPE ({rpe})</Label>

            <Slider min={1} max={10} step={1} value={[rpe]} onValueChange={(v) => setRpe(v[0])} />
          </div>

          <Button onClick={complete} size="sm">
            {session.completed_at ? "Update" : "Complete"}
          </Button>
        </div>

        <div>
          <Label className="text-xs">How did you feel?</Label>
          <div className="mt-2">
            <FeelFaces value={feel} onChange={setFeel} />
          </div>
        </div>

        {!session.completed_at && (
          <Button
            onClick={completeWithoutReflection}
            size="sm"
            variant="ghost"
            className="text-xs text-muted-foreground h-auto py-1 px-2 -ml-2"
          >
            Mark complete without reflection
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// Formats a work step's structure into a short human-readable summary for
// the Overview card, e.g. "8 × 1km" + a separate "1 min Recovery
// (standing)" part so the caller can render the recovery portion in
// smaller text. Continuous work (reps <= 1) just has a main part — there's
// no recovery to describe. Prefers whichever target (distance or time) the
// step actually used, since FIT-derived steps and manually-planned steps
// can differ.
function formatWorkoutStructure(step: any): { main: string; recovery: string | null } | null {
  if (!step) return null;

  const unit =
    step.target_kind === "distance" && step.target_distance_m
      ? metersFmt(roundDistanceForDisplay(step.target_distance_m))
      : step.target_kind === "time" && step.target_time_seconds
        ? secToClock(step.target_time_seconds)
        : null;

  if (!unit) return null;
  if (step.reps <= 1) return { main: unit, recovery: null };

  const repsPart = `${step.reps} × ${unit}`;
  const recoveryMode = step.recovery_between_reps_mode ? ` (${step.recovery_between_reps_mode})` : "";

  const recoveryPart =
    step.recovery_between_reps_target_kind === "distance" && step.recovery_between_reps_distance_m
      ? `${metersFmt(roundDistanceForDisplay(step.recovery_between_reps_distance_m))} Recovery${recoveryMode}`
      : step.recovery_between_reps_seconds
        ? `${formatRecoveryDuration(roundRecoverySeconds(step.recovery_between_reps_seconds))} Recovery${recoveryMode}`
        : null;

  return { main: repsPart, recovery: recoveryPart };
}

// "1 min" for whole minutes (the common case for recovery), falling back
// to clock format (e.g. "1:30") for anything that isn't a whole minute.
function formatRecoveryDuration(seconds: number): string {
  if (seconds > 0 && seconds % 60 === 0) {
    const mins = seconds / 60;
    return `${mins} min`;
  }
  return secToClock(seconds);
}
