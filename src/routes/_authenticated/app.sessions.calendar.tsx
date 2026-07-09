import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyAthlete, useMyRoles, useMyRawRoles } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, List as ListIcon, Upload, CalendarPlus, PencilLine } from "lucide-react";
import {
  CalendarDayCell,
  type CalendarSession,
  type DayData,
  sessionColorClass,
  sessionShortLabel,
} from "@/components/calendar-day-cell";
import { sessionClassificationLabel } from "@/lib/session-categories";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { useServerFn } from "@tanstack/react-start";
import { uploadAndParseSessionFile } from "@/lib/session-files.functions";
import { toast } from "sonner";

const searchSchema = z.object({
  athleteId: z.string().optional(),
  view: z.enum(["month", "week"]).optional(),
  date: z.string().optional(), // YYYY-MM-DD anchor
});

export const Route = createFileRoute("/_authenticated/app/sessions/calendar")({
  validateSearch: searchSchema,
  component: CalendarPage,
});

// --- date helpers (UTC-safe ISO YYYY-MM-DD math) ---
function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseISO(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfWeek(d: Date) {
  const x = new Date(d);
  const dow = x.getDay();
  return addDays(x, -dow);
} // Sunday start
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function CalendarPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const qc = useQueryClient();
  const uploadFile = useServerFn(uploadAndParseSessionFile);
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const { data: rawRoles = [] } = useMyRawRoles();
  const { data: myAthlete } = useMyAthlete();
  const isCoach = roles.includes("coach");
  const isManager = rawRoles.includes("manager");

  const view = search.view ?? "month";
  const anchor = search.date ? parseISO(search.date) : new Date();

  // Coach roster
  const { data: roster } = useQuery({
    queryKey: ["calendar-roster", user?.id, isCoach, isManager],
    enabled: !!user && isCoach,
    queryFn: async () => {
      if (isManager) {
        const { data } = await supabase.from("athletes").select("id, name, profile_image_url").order("name");
        return (data ?? []) as { id: string; name: string; profile_image_url: string | null }[];
      }
      const { data } = await supabase
        .from("coach_athletes")
        .select("athlete_id, athletes(id, name, profile_image_url)")
        .eq("coach_user_id", user!.id);
      return (data ?? []).map((r: any) => r.athletes).filter(Boolean) as {
        id: string;
        name: string;
        profile_image_url: string | null;
      }[];
    },
  });

  const selectedAthleteId = search.athleteId ?? myAthlete?.id ?? roster?.[0]?.id ?? "";

  // Date range to load
  const { rangeStart, rangeEnd, gridDays, weekStart } = useMemo(() => {
    if (view === "week") {
      const ws = startOfWeek(anchor);
      const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
      return { rangeStart: toISO(ws), rangeEnd: toISO(addDays(ws, 6)), gridDays: days, weekStart: ws };
    }
    const mStart = startOfMonth(anchor);
    const mEnd = endOfMonth(anchor);
    const gStart = startOfWeek(mStart);
    const gEnd = addDays(startOfWeek(mEnd), 6);
    const len = Math.round((+gEnd - +gStart) / 86400000) + 1;
    const days = Array.from({ length: len }, (_, i) => addDays(gStart, i));
    return { rangeStart: toISO(gStart), rangeEnd: toISO(gEnd), gridDays: days, weekStart: gStart };
  }, [view, anchor]);

  const { data: bundle } = useQuery({
    queryKey: ["calendar", selectedAthleteId, rangeStart, rangeEnd],
    enabled: !!selectedAthleteId,
    queryFn: async () => {
      const [{ data: sessions }, { data: load }] = await Promise.all([
        supabase
          .from("sessions")
          .select(
            "id, title, session_date, day_type, intent, structure, is_long_run, completed_at, is_planned, activity_type",
          )
          .eq("athlete_id", selectedAthleteId)
          .gte("session_date", rangeStart)
          .lte("session_date", rangeEnd)
          .order("session_date", { ascending: true }),
        supabase
          .from("athlete_load_daily")
          .select("load_date, readiness_status, readiness_score, training_load")
          .eq("athlete_id", selectedAthleteId)
          .gte("load_date", rangeStart)
          .lte("load_date", rangeEnd),
      ]);
      const sIds = (sessions ?? []).map((s) => s.id);
      let fatigue: any[] = [];
      if (sIds.length) {
        const { data: fz } = await supabase
          .from("session_fatigue")
          .select("session_id, efficiency_score")
          .in("session_id", sIds);
        fatigue = fz ?? [];
      }
      return { sessions: (sessions ?? []) as CalendarSession[], load: load ?? [], fatigue };
    },
  });

  // Aggregate by date
  const byDate = useMemo(() => {
    const map = new Map<string, DayData>();
    for (const d of gridDays) map.set(toISO(d), { date: toISO(d), sessions: [] });
    if (bundle) {
      // Average efficiency per session across its work steps
      const effSum = new Map<string, { sum: number; n: number }>();
      for (const f of bundle.fatigue) {
        if (f.efficiency_score == null) continue;
        const cur = effSum.get(f.session_id) ?? { sum: 0, n: 0 };
        cur.sum += f.efficiency_score;
        cur.n += 1;
        effSum.set(f.session_id, cur);
      }
      const effBySession: Record<string, number> = {};
      for (const [sid, v] of effSum) effBySession[sid] = v.sum / v.n;

      for (const s of bundle.sessions) {
        const day = map.get(s.session_date);
        if (!day) continue;
        day.sessions.push(s);
        day.efficiencyBySession = day.efficiencyBySession ?? {};
        if (effBySession[s.id] != null) day.efficiencyBySession[s.id] = effBySession[s.id];
      }
      for (const r of bundle.load) {
        const day = map.get(r.load_date);
        if (!day) continue;
        day.readiness_status = r.readiness_status as any;
        day.readiness_score = r.readiness_score as any;
        day.training_load = r.training_load as any;
      }
    }
    return map;
  }, [bundle, gridDays]);

  const todayISO = toISO(new Date());
  const monthLabel = anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const weekLabel = `${weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(weekStart, 6).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;

  function shift(delta: number) {
    const next =
      view === "month" ? new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1) : addDays(anchor, delta * 7);
    navigate({ search: (p: any) => ({ ...p, date: toISO(next) }) });
  }
  function goToday() {
    navigate({ search: (p: any) => ({ ...p, date: undefined }) });
  }
  function setView(v: "month" | "week") {
    navigate({ search: (p: any) => ({ ...p, view: v }) });
  }

  const [sheetDay, setSheetDay] = useState<DayData | null>(null);
  // Date (YYYY-MM-DD) currently showing the "add to this day" menu — works
  // on any day, empty or not, so existing sessions are never blocked from
  // getting a second one added alongside them.
  const [addMenuDate, setAddMenuDate] = useState<string | null>(null);
  const [uploadDate, setUploadDate] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Creates a bare session row for the given date, then attaches the
  // uploaded file to it via the same uploadAndParseSessionFile flow the
  // session detail page uses. day_type/intent/structure defaults are
  // required by the DB's validate_session_classification trigger for any
  // 'training' row; title starts as a placeholder matching the
  // auto-generated pattern so rebuildSessionFromAllFiles corrects it to the
  // real time-of-day title once the file's actually parsed.
  async function handleCalendarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !uploadDate || !selectedAthleteId || !user) return;

    setUploading(true);
    try {
      const { data: newSession, error: createErr } = await supabase
        .from("sessions")
        .insert({
          athlete_id: selectedAthleteId,
          session_date: uploadDate,
          day_type: "training",
          intent: "easy",
          structure: "continuous",
          is_planned: false,
          source: "fit_import",
          title: "Morning session",
          created_by: user.id,
        } as any)
        .select("id, athlete_id")
        .single();

      if (createErr || !newSession) throw createErr ?? new Error("Could not create session");

      const reader = new FileReader();
      const base64: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result || "").split(",")[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });

      // NOTE: this mirrors the exact call site used on the session detail
      // page (app.sessions.$sessionId.index.tsx, handleFileUpload) — same
      // shape, just with the session we just created above. Worth a quick
      // sanity check against that page if this doesn't behave as expected.
      const res: any = await uploadFile({
        data: {
          athleteId: newSession.athlete_id,
          sessionId: newSession.id,
          filename: file.name,
          kind: file.name.toLowerCase().endsWith(".gpx") ? "gpx" : "fit",
          fileBase64: base64,
        },
      });

      if (res?.error) throw new Error(res.error);

      toast.success("File uploaded and session created");
      qc.invalidateQueries({ queryKey: ["calendar"] });
      setUploadDate(null);
      navigate({ to: "/app/sessions/$sessionId", params: { sessionId: newSession.id } });
    } catch (err: any) {
      console.error("Calendar upload error:", err);
      toast.error(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Calendar</h1>
            <p className="text-xs text-muted-foreground">Sessions by date · color = intent / day type</p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/app/sessions">
                <ListIcon className="h-4 w-4 mr-1" /> List view
              </Link>
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => shift(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={goToday}>
              Today
            </Button>
            <Button variant="outline" size="icon" onClick={() => shift(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="ml-2 text-sm font-medium">{view === "month" ? monthLabel : weekLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            {isCoach &&
              roster &&
              roster.length > 0 &&
              (() => {
                const sel =
                  roster.find((a) => a.id === selectedAthleteId) ??
                  (myAthlete && myAthlete.id === selectedAthleteId
                    ? {
                        id: myAthlete.id,
                        name: myAthlete.name,
                        profile_image_url: (myAthlete as any).profile_image_url,
                      }
                    : null);
                return (
                  <div className="flex items-center gap-2">
                    {sel && <UserAvatar name={sel.name} imageUrl={sel.profile_image_url} size="sm" />}
                    <Select
                      value={selectedAthleteId}
                      onValueChange={(v) => navigate({ search: (p: any) => ({ ...p, athleteId: v }) })}
                    >
                      <SelectTrigger className="h-9 w-[180px]">
                        <SelectValue placeholder="Select athlete" />
                      </SelectTrigger>
                      <SelectContent>
                        {myAthlete && <SelectItem value={myAthlete.id}>{myAthlete.name} (me)</SelectItem>}
                        {roster
                          .filter((a) => a.id !== myAthlete?.id)
                          .map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })()}
            <div className="inline-flex rounded-md border overflow-hidden">
              <button
                onClick={() => setView("month")}
                className={cn("px-3 py-1.5 text-xs", view === "month" ? "bg-accent" : "bg-background")}
              >
                Month
              </button>
              <button
                onClick={() => setView("week")}
                className={cn("px-3 py-1.5 text-xs border-l", view === "week" ? "bg-accent" : "bg-background")}
              >
                Week
              </button>
            </div>
          </div>
        </div>

        <Card>
          <CardContent className="p-2 sm:p-3">
            <div className="grid grid-cols-7 gap-1 mb-1 text-[10px] text-muted-foreground">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="text-center uppercase tracking-wide">
                  {d}
                </div>
              ))}
            </div>
            <div className={cn("grid gap-1", view === "week" ? "grid-cols-7" : "grid-cols-7")}>
              {gridDays.map((d) => {
                const iso = toISO(d);
                const day = byDate.get(iso)!;
                const inMonth = view === "week" ? true : d.getMonth() === anchor.getMonth();
                return (
                  <CalendarDayCell
                    key={iso}
                    day={day}
                    inMonth={inMonth}
                    isToday={iso === todayISO}
                    compact={isMobile && view === "month"}
                    onMultiClick={(dd) => setSheetDay(dd)}
                    onAdd={(date) => setAddMenuDate(date)}
                  />
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Legend />
      </div>

      <Sheet open={!!sheetDay} onOpenChange={(o) => !o && setSheetDay(null)}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-auto">
          <SheetHeader>
            <SheetTitle>
              {sheetDay
                ? parseISO(sheetDay.date).toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })
                : ""}
            </SheetTitle>
          </SheetHeader>
          {sheetDay && (
            <div className="mt-4 space-y-2">
              {sheetDay.readiness_status && (
                <div className="text-xs text-muted-foreground">
                  Readiness: <span className="font-medium capitalize">{sheetDay.readiness_status}</span>
                  {sheetDay.readiness_score != null ? ` · ${Math.round(sheetDay.readiness_score)}` : ""}
                  {sheetDay.training_load != null ? ` · Training load ${Math.round(sheetDay.training_load)}` : ""}
                </div>
              )}
              {sheetDay.sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sessions on this day.</p>
              ) : (
                sheetDay.sessions.map((s) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <Link
                      to="/app/sessions/$sessionId"
                      params={{ sessionId: s.id }}
                      onClick={() => setSheetDay(null)}
                      className="flex-1 flex items-stretch gap-2 rounded-md border hover:bg-accent/40 overflow-hidden"
                    >
                      <span className={cn("w-1.5", sessionColorClass(s))} />
                      <div className="py-2 pr-2 min-w-0">
                        <div className="text-sm font-medium truncate">{s.title}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {sessionShortLabel(s)} · {sessionClassificationLabel(s)} ·{" "}
                          {s.completed_at ? "Completed" : "Planned"}
                        </div>
                      </div>
                    </Link>
                    {s.completed_at && (
                      <Button asChild variant="outline" size="sm">
                        <Link
                          to="/app/sessions/$sessionId/analysis"
                          params={{ sessionId: s.id }}
                          onClick={() => setSheetDay(null)}
                        >
                          Analysis
                        </Link>
                      </Button>
                    )}
                  </div>
                ))
              )}
              {isCoach && sheetDay.sessions.length === 0 && (
                <Button asChild size="sm" variant="outline">
                  <Link to="/app/sessions/new" onClick={() => setSheetDay(null)}>
                    + New session
                  </Link>
                </Button>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* "Add to this day" menu — three entry points, all pre-filled with the
          clicked date so there's no re-picking it in the next screen. */}
      <Dialog open={!!addMenuDate} onOpenChange={(o) => !o && setAddMenuDate(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {addMenuDate
                ? parseISO(addMenuDate).toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })
                : ""}
            </DialogTitle>
            <DialogDescription>
              Add a session to this day. Existing sessions on this day aren't affected.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                const d = addMenuDate;
                setAddMenuDate(null);
                setUploadDate(d);
              }}
            >
              <Upload className="h-4 w-4 mr-2" /> Upload file
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                const d = addMenuDate;
                setAddMenuDate(null);
                // NOTE: pre-filling the date/mode here assumes
                // app.sessions.new.tsx reads these from its search params —
                // worth confirming against that file; if it doesn't yet,
                // the date will just need picking manually on that screen.
                navigate({ to: "/app/sessions/new", search: { date: d, mode: "planned" } as any });
              }}
            >
              <CalendarPlus className="h-4 w-4 mr-2" /> Create Session
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                const d = addMenuDate;
                setAddMenuDate(null);
                navigate({ to: "/app/sessions/new", search: { date: d, mode: "manual" } as any });
              }}
            >
              <PencilLine className="h-4 w-4 mr-2" /> Manual Session Entry
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Upload dialog — separate from the menu above so the file picker
          only mounts once a date's actually been chosen. */}
      <Dialog open={!!uploadDate} onOpenChange={(o) => !o && !uploading && setUploadDate(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Upload file</DialogTitle>
            <DialogDescription>
              {uploadDate
                ? parseISO(uploadDate).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
                : ""}
              {" · "}FIT or GPX
            </DialogDescription>
          </DialogHeader>
          <input
            type="file"
            accept=".fit,.gpx"
            disabled={uploading}
            onChange={handleCalendarUpload}
            className="text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
          />
          {uploading && <p className="text-xs text-muted-foreground">Uploading and parsing…</p>}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Legend() {
  const items: { label: string; cls: string }[] = [
    { label: "Easy", cls: "bg-emerald-500" },
    { label: "Aerobic", cls: "bg-teal-500" },
    { label: "Tempo", cls: "bg-amber-500" },
    { label: "Threshold", cls: "bg-orange-500" },
    { label: "VO2", cls: "bg-red-500" },
    { label: "Anaerobic", cls: "bg-rose-600" },
    { label: "Speed", cls: "bg-fuchsia-500" },
    { label: "Race", cls: "bg-purple-600" },
    { label: "Recovery", cls: "bg-sky-400" },
    { label: "Cross-train", cls: "bg-slate-400" },
    { label: "Rest", cls: "bg-stone-300" },
  ];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1">
          <span className={cn("h-2 w-3 rounded-sm", i.cls)} /> {i.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1 ml-2">
        <span className="h-2 w-2 rounded-full bg-emerald-500" /> readiness
      </span>
    </div>
  );
}
