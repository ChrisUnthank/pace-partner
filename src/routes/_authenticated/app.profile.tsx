import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyAthlete, useAuthUser, useMyRawRoles, type AppRole } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { metersFmt, secToClock, clockToSec } from "@/lib/format";
import { toast } from "sonner";
import { Trash2, Sparkles } from "lucide-react";
import { ProfileImageUploader } from "@/components/profile-image-uploader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setStoredUnits } from "@/lib/units";
import { TIMEZONE_OPTIONS, guessLocalTimezone } from "@/lib/timezones";
import { ZoneBoundariesCard } from "@/components/zone-boundaries-card";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export const Route = createFileRoute("/_authenticated/app/profile")({
  component: Profile,
});

type RaceType = "track" | "road" | "cross_country";

type BulkImportRow = {
  athlete_id: string;
  performance_date: string;
  distance_m: number;
  time_seconds: number | null;
  is_pb: boolean;
  context: string;
  notes: string;
  event_name: string;
  age_group: string | null;
  race_type: RaceType;
  distance_adjustment_mode: string;
  source_event: string;
  source_perf: string;
  source_venue: string;
  duplicate?: boolean;
  error?: string;
};

function Profile() {
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRawRoles();
  const { data: athlete } = useMyAthlete();
  const qc = useQueryClient();

  const { data: zones } = useQuery({
    queryKey: ["zone-profile", athlete?.id],
    enabled: !!athlete,
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_zone_profiles")
        .select("*")
        .eq("athlete_id", athlete!.id)
        .maybeSingle();
      return data;
    },
  });

  const { data: pbs } = useQuery({
    queryKey: ["my-pbs", athlete?.id],
    enabled: !!athlete,
    queryFn: async () => {
      const { data } = await supabase
        .from("performances")
        .select("*")
        .eq("athlete_id", athlete!.id)
        .order("performance_date", { ascending: false });
      return data ?? [];
    },
  });

  return (
    <AppShell>
      <div className="space-y-6 max-w-6xl">
        <h1 className="text-2xl font-bold">Profile</h1>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Left column: athlete details up top, roles underneath */}
          <div className="space-y-6">
            {athlete && <AthleteForm athlete={athlete} />}
            {user && <RolesCard userId={user.id} roles={roles} email={user.email ?? ""} />}
            {user && <JoinRequestsInbox userId={user.id} />}
          </div>

          {/* Right column: account & photo up top, preferences underneath */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Account</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <div>
                  <span className="text-muted-foreground">Email:</span> {user?.email}
                </div>
                <div>
                  <span className="text-muted-foreground">Roles:</span> {roles.join(", ") || "none"}
                </div>
              </CardContent>
            </Card>

            <ChangePasswordCard />

            {user && <ProfileImageUploader userId={user.id} name={user.user_metadata?.full_name ?? user.email ?? ""} />}
            {user && <PreferencesCard userId={user.id} />}
          </div>
        </div>

        {/* Full width: zone boundaries */}
        {athlete && <ZoneBoundariesCard athleteId={athlete.id} profile={zones} />}

        {/* Full width: performances table + chart need the extra room */}
        {athlete && (
          <PBsCard
            athleteId={athlete.id}
            pbs={pbs ?? []}
            onChange={() => qc.invalidateQueries({ queryKey: ["my-pbs"] })}
          />
        )}

        {/* Full width, last: AI assistant */}
        {user && (
          <AiAccessCard
            userId={user.id}
            isAthlete={roles.includes("athlete")}
            isCoach={roles.includes("coach") || roles.includes("manager")}
          />
        )}
      </div>
    </AppShell>
  );
}

function PreferencesCard({ userId }: { userId: string }) {
  const qc = useQueryClient();

  const { data: profile } = useQuery({
    queryKey: ["my-profile", userId],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("units, timezone").eq("id", userId).maybeSingle();
      return data;
    },
  });

  const [units, setUnits] = useState<string>((profile?.units as string) ?? "metric");
  const [tz, setTz] = useState<string>((profile?.timezone as string) ?? guessLocalTimezone());

  if (profile && profile.units && profile.units !== units && units === "metric") {
    setUnits(profile.units);
  }

  async function save() {
    const { error } = await supabase.from("profiles").update({ units, timezone: tz }).eq("id", userId);

    if (error) {
      toast.error(error.message);
      return;
    }

    setStoredUnits(units as any);
    toast.success("Preferences saved");
    qc.invalidateQueries({ queryKey: ["my-profile", userId] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Display preferences</CardTitle>
        <CardDescription>
          Units and time zone used when this account views the app. This doesn't affect how an athlete's own session
          times are classified — that uses the timezone set on each athlete's own details, below.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label>Units</Label>
          <Select value={units} onValueChange={setUnits}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="metric">Metric (km)</SelectItem>
              <SelectItem value="imperial">Imperial (mi)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Time zone</Label>
          <Select value={tz} onValueChange={setTz}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONE_OPTIONS.map((z) => (
                <SelectItem key={z.value} value={z.value}>
                  {z.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="sm:col-span-2">
          <Button onClick={save}>Save preferences</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ChangePasswordCard() {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    setNewPassword("");
    setConfirmPassword("");
    toast.success("Password updated");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>
          Update the password used to sign in. You're already signed in, so no need to enter the old one.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div>
          <Label className="text-xs">New password</Label>
          <Input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="At least 8 characters"
          />
        </div>

        <div>
          <Label className="text-xs">Confirm new password</Label>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>

        <Button onClick={save} disabled={saving || !newPassword || !confirmPassword}>
          {saving ? "Updating..." : "Update password"}
        </Button>
      </CardContent>
    </Card>
  );
}

function JoinRequestsInbox({ userId }: { userId: string }) {
  const qc = useQueryClient();

  const { data: requests } = useQuery({
    queryKey: ["my-join-requests", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_join_requests")
        .select("id, status, message, created_at, coach_user_id, athlete_id, athletes(name)")
        .eq("target_user_id", userId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (!data?.length) return [];

      const coachIds = Array.from(new Set(data.map((r: any) => r.coach_user_id)));
      const { data: coaches } = await supabase.from("profiles").select("id, full_name, email").in("id", coachIds);
      const coachMap = new Map((coaches ?? []).map((c: any) => [c.id, c]));

      return data.map((r: any) => ({ ...r, coach: coachMap.get(r.coach_user_id) }));
    },
  });

  async function respond(id: string, accept: boolean) {
    const { data, error } = await (supabase.rpc as any)("respond_to_join_request", {
      _request_id: id,
      _accept: accept,
    });

    if (error) {
      toast.error(error.message);
      return;
    }

    const result = data as any;

    if (result?.ok === false) {
      toast.error(result.error ?? "Failed");
      return;
    }

    toast.success(accept ? "Joined coach's squad" : "Declined");
    qc.invalidateQueries({ queryKey: ["my-join-requests"] });
    qc.invalidateQueries({ queryKey: ["my-athlete"] });
    qc.invalidateQueries({ queryKey: ["my-roles"] });
  }

  if (!requests || requests.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Coach invitations</CardTitle>
        <CardDescription>Coaches who want to add you to their roster.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-2">
        {requests.map((r: any) => (
          <div key={r.id} className="flex items-center justify-between gap-3 border rounded px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="font-medium truncate">{r.coach?.full_name ?? r.coach?.email ?? "A coach"}</div>
              {r.message && <div className="text-xs text-muted-foreground truncate">{r.message}</div>}
            </div>

            <div className="flex gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={() => respond(r.id, false)}>
                Decline
              </Button>
              <Button size="sm" onClick={() => respond(r.id, true)}>
                Accept
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function RolesCard({ userId, roles, email }: { userId: string; roles: AppRole[]; email: string }) {
  const qc = useQueryClient();
  const has = (r: AppRole) => roles.includes(r);

  async function toggle(r: "athlete" | "coach" | "manager", on: boolean) {
    if (on) {
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: r });

      if (error && !error.message.includes("duplicate")) {
        toast.error(error.message);
        return;
      }

      if (r === "athlete") {
        const { data: existing } = await supabase.from("athletes").select("id").eq("user_id", userId).maybeSingle();

        if (!existing) {
          await supabase.from("athletes").insert({ user_id: userId, name: email || "Athlete", created_by: userId });
        }
      }
    } else {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", r);

      if (error) {
        toast.error(error.message);
        return;
      }
    }

    toast.success("Role updated");
    qc.invalidateQueries({ queryKey: ["my-raw-roles"] });
    qc.invalidateQueries({ queryKey: ["my-roles"] });
    qc.invalidateQueries({ queryKey: ["my-athlete"] });
  }

  const items: { role: "athlete" | "coach" | "manager"; label: string; desc: string }[] = [
    { role: "athlete", label: "Athlete", desc: "See your own training, check-ins, PBs and readiness." },
    { role: "coach", label: "Coach", desc: "Manage your linked roster of athletes, sessions and templates." },
    { role: "manager", label: "Manager", desc: "Team / squad administrator — coach-level access to every athlete." },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roles</CardTitle>
        <CardDescription>
          You can be more than one. Turning off Athlete hides athlete-only views but keeps your training data.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {items.map((it) => (
          <label key={it.role} className="flex items-start gap-3 cursor-pointer">
            <Checkbox checked={has(it.role)} onCheckedChange={(v) => toggle(it.role, !!v)} className="mt-0.5" />
            <div>
              <div className="text-sm font-medium">{it.label}</div>
              <div className="text-xs text-muted-foreground">{it.desc}</div>
            </div>
          </label>
        ))}
      </CardContent>
    </Card>
  );
}

function AthleteForm({ athlete }: { athlete: any }) {
  const qc = useQueryClient();
  const [name, setName] = useState(athlete.name);
  const [event, setEvent] = useState(athlete.primary_event ?? "");
  const [dob, setDob] = useState(athlete.dob ?? "");
  const [trainingAge, setTrainingAge] = useState(athlete.training_age_years ?? "");
  const [hrMax, setHrMax] = useState(athlete.hr_max ?? "");
  const [timezone, setTimezone] = useState(athlete.timezone ?? guessLocalTimezone());

  async function save() {
    const { error } = await supabase
      .from("athletes")
      .update({
        name,
        primary_event: event || null,
        dob: dob || null,
        training_age_years: trainingAge === "" ? null : Number(trainingAge),
        hr_max: hrMax === "" ? null : Number(hrMax),
        timezone,
      })
      .eq("id", athlete.id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["my-athlete"] });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Athlete details</CardTitle>
      </CardHeader>

      <CardContent className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <Label>Primary event</Label>
          <Input value={event} onChange={(e) => setEvent(e.target.value)} placeholder="e.g. 1500m" />
        </div>

        <div>
          <Label>DOB</Label>
          <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
        </div>

        <div>
          <Label>Training age (years)</Label>
          <Input type="number" value={trainingAge} onChange={(e) => setTrainingAge(e.target.value)} />
        </div>

        <div>
          <Label>HR max</Label>
          <Input type="number" value={hrMax} onChange={(e) => setHrMax(e.target.value)} />
        </div>

        <div>
          <Label>Time zone</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONE_OPTIONS.map((z) => (
                <SelectItem key={z.value} value={z.value}>
                  {z.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <p className="text-xs text-muted-foreground mt-1">
            Used to classify session times (Morning/Afternoon/Evening) and to show local session times correctly.
          </p>
        </div>

        <div className="sm:col-span-2">
          <Button onClick={save}>Save</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function eventToDistanceM(event: string): number | null {
  const e = cleanImportCell(event).toLowerCase();

  if (/^1\s*mile$/i.test(e)) return 1609;

  const km = e.match(/^(\d+(?:\.\d+)?)\s*km/i);
  if (km) return Math.round(Number(km[1]) * 1000);

  const m = e.match(/^(\d+)\s*m/i);
  if (m) return Number(m[1]);

  return null;
}

function cleanImportCell(value: string) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r/g, "")
    .trim();
}

function cleanPipeCell(value: string) {
  return cleanImportCell(value).replace(/\|/g, "/").trim();
}

function extractDate(value: string): string | null {
  const cleaned = cleanImportCell(value);
  const match = cleaned.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function looksLikePerformance(value: string) {
  const v = cleanImportCell(value);

  if (!v) return false;

  return (
    /^\d+(?::\d{1,2}(?:\.\d+)?)?$/.test(v) ||
    /^\d+(?:\.\d+)?h$/i.test(v) ||
    /^\([-+]?\d+(?:\.\d+)?\)$/.test(v) ||
    /^DNF$/i.test(v) ||
    /^SCR$/i.test(v)
  );
}

function performanceToSeconds(perf: string): { seconds: number | null; notes: string } {
  const original = cleanImportCell(perf);
  const upper = original.toUpperCase();
  const notes: string[] = [];

  if (!original || upper === "DNF" || upper === "SCR") {
    return {
      seconds: null,
      notes: `Original result: ${original || "no performance listed"}`,
    };
  }

  if (/\(.+\)/.test(original)) {
    notes.push(`Wind/extra mark from source: ${original}`);
  }

  if (/h$/i.test(original)) {
    notes.push(`Hand timed mark from source: ${original}`);
  }

  const cleaned = original
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/h$/i, "")
    .trim();

  if (cleaned.includes(":")) {
    const [minRaw, secRaw] = cleaned.split(":");
    const min = Number(minRaw);
    const sec = Number(secRaw);

    if (Number.isNaN(min) || Number.isNaN(sec)) {
      return {
        seconds: null,
        notes: [`Could not parse original result: ${original}`, ...notes].join("; "),
      };
    }

    return {
      seconds: Math.round((min * 60 + sec) * 100) / 100,
      notes: notes.join("; "),
    };
  }

  const seconds = Number(cleaned);

  if (Number.isNaN(seconds)) {
    return {
      seconds: null,
      notes: [`Could not parse original result: ${original}`, ...notes].join("; "),
    };
  }

  return {
    seconds: Math.round(seconds * 100) / 100,
    notes: notes.join("; "),
  };
}

function raceTypeFromEvent(event: string): RaceType {
  if (/XC/i.test(event)) return "cross_country";
  if (/Road|Tan Relay|Ten Relay/i.test(event)) return "road";
  return "track";
}

function raceTypeLabel(rt: string) {
  switch (rt) {
    case "track":
      return "Track";
    case "road":
      return "Road";
    case "cross_country":
      return "XC";
    default:
      return rt;
  }
}

function performanceKey(row: {
  performance_date?: string | null;
  distance_m?: number | null;
  time_seconds?: number | null;
  event_name?: string | null;
}) {
  const date = row.performance_date ?? "";
  const distance = row.distance_m ?? "";
  const seconds = row.time_seconds == null ? "NULL" : Number(row.time_seconds).toFixed(2);
  const eventName = row.event_name ?? "";
  return `${date}|${distance}|${seconds}|${eventName}`;
}

function parseAvRecordToPipe(record: string[]): string | null {
  const date = extractDate(record[0] ?? "");
  if (!date) return null;

  const body = record.slice(1).map(cleanPipeCell).filter(Boolean);

  if (body.length === 0) return null;

  const eventIndex = body.findIndex((item) => eventToDistanceM(item) !== null);

  if (eventIndex === -1) {
    return `${date} |  |  | ${body.join(" ")}`;
  }

  const event = body[eventIndex];
  const afterEvent = body.slice(eventIndex + 1);

  let venue = "";
  let perfParts: string[] = [];

  if (afterEvent.length === 0) {
    venue = "";
    perfParts = [];
  } else {
    let venueIndex = -1;

    for (let i = afterEvent.length - 1; i >= 0; i--) {
      if (!looksLikePerformance(afterEvent[i])) {
        venueIndex = i;
        break;
      }
    }

    if (venueIndex >= 0) {
      venue = afterEvent[venueIndex];
      perfParts = afterEvent.slice(0, venueIndex);
    } else {
      venue = "";
      perfParts = afterEvent;
    }
  }

  const perf = perfParts.join(" ").trim();

  return `${date} | ${event} | ${perf} | ${venue}`;
}

function normaliseBulkImportText(text: string): string[] {
  const rawLines = text
    .split(/\r?\n/)
    .flatMap((line) => line.split("\t"))
    .map(cleanImportCell)
    .filter(Boolean)
    .filter((line) => !/^meet date$/i.test(line))
    .filter((line) => !/^event$/i.test(line))
    .filter((line) => !/^perf$/i.test(line))
    .filter((line) => !/^venue$/i.test(line));

  if (rawLines.length === 0) return [];

  if (rawLines.some((line) => line.includes("|"))) {
    return rawLines;
  }

  const records: string[][] = [];
  let current: string[] = [];

  for (const line of rawLines) {
    const date = extractDate(line);

    if (date) {
      if (current.length > 0) {
        records.push(current);
      }

      current = [date];
    } else if (current.length > 0) {
      current.push(line);
    }
  }

  if (current.length > 0) {
    records.push(current);
  }

  return records.map(parseAvRecordToPipe).filter((row): row is string => Boolean(row));
}

function parseBulkPerformances(text: string, athleteId: string): BulkImportRow[] {
  const lines = normaliseBulkImportText(text);

  const rows: BulkImportRow[] = lines.map((line) => {
    const parts = line.split("|").map(cleanImportCell);

    if (parts.length !== 4) {
      return {
        athlete_id: athleteId,
        performance_date: "",
        distance_m: 0,
        time_seconds: null,
        is_pb: false,
        context: "race",
        notes: "",
        event_name: "",
        age_group: null,
        race_type: "track",
        distance_adjustment_mode: "uniform",
        source_event: "",
        source_perf: "",
        source_venue: "",
        error: `Invalid row. Use: YYYY-MM-DD | Event | Performance | Venue`,
      };
    }

    const [performanceDateRaw, sourceEventRaw, sourcePerfRaw, sourceVenueRaw] = parts;

    const performance_date = extractDate(performanceDateRaw) ?? performanceDateRaw;
    const source_event = cleanPipeCell(sourceEventRaw);
    const source_perf = cleanPipeCell(sourcePerfRaw);
    const source_venue = cleanPipeCell(sourceVenueRaw);

    const distance_m = eventToDistanceM(source_event);
    const race_type = raceTypeFromEvent(source_event);
    const { seconds, notes } = performanceToSeconds(source_perf);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(performance_date)) {
      return {
        athlete_id: athleteId,
        performance_date,
        distance_m: distance_m ?? 0,
        time_seconds: seconds,
        is_pb: false,
        context: "race",
        notes,
        event_name: source_venue ? `${source_event} - ${source_venue}` : source_event,
        age_group: null,
        race_type,
        distance_adjustment_mode: "uniform",
        source_event,
        source_perf,
        source_venue,
        error: `Invalid date: ${performanceDateRaw}`,
      };
    }

    if (!distance_m) {
      return {
        athlete_id: athleteId,
        performance_date,
        distance_m: 0,
        time_seconds: seconds,
        is_pb: false,
        context: "race",
        notes,
        event_name: source_venue ? `${source_event} - ${source_venue}` : source_event,
        age_group: null,
        race_type,
        distance_adjustment_mode: "uniform",
        source_event,
        source_perf,
        source_venue,
        error: `Could not parse distance from event: ${source_event || "(blank)"}`,
      };
    }

    return {
      athlete_id: athleteId,
      performance_date,
      distance_m,
      time_seconds: seconds,
      is_pb: false,
      context: "race",
      notes,
      event_name: source_venue ? `${source_event} - ${source_venue}` : source_event,
      age_group: null,
      race_type,
      distance_adjustment_mode: "uniform",
      source_event,
      source_perf,
      source_venue,
    };
  });

  const bests = new Map<string, number>();

  [...rows]
    .filter((row) => !row.error)
    .sort((a, b) => {
      const byDate = a.performance_date.localeCompare(b.performance_date);
      if (byDate !== 0) return byDate;
      return a.distance_m - b.distance_m;
    })
    .forEach((row) => {
      if (row.time_seconds == null) {
        row.is_pb = false;
        return;
      }

      const key = `${row.distance_m}-${row.race_type}`;
      const previousBest = bests.get(key);

      if (previousBest == null || row.time_seconds < previousBest) {
        row.is_pb = true;
        bests.set(key, row.time_seconds);
      } else {
        row.is_pb = false;
      }
    });

  return rows;
}

function displaySeconds(seconds: number | null | undefined) {
  if (seconds == null) return "—";

  try {
    return secToClock(seconds);
  } catch {
    return String(seconds);
  }
}

function formatChartDate(dateStr: string) {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}`;
}

const PERFORMANCES_PAGE_SIZE = 10;

function PBsCard({ athleteId, pbs, onChange }: { athleteId: string; pbs: any[]; onChange: () => void }) {
  const [date, setDate] = useState("");
  const [dist, setDist] = useState(1500);
  const [time, setTime] = useState("");

  const [bulkText, setBulkText] = useState("");
  const [previewRows, setPreviewRows] = useState<BulkImportRow[]>([]);
  const [importing, setImporting] = useState(false);

  const [showAllPerformances, setShowAllPerformances] = useState(false);
  const [selectedEventKey, setSelectedEventKey] = useState<string>("");

  const existingKeys = useMemo(() => {
    return new Set((pbs ?? []).map((p) => performanceKey(p)));
  }, [pbs]);

  // Current best time per (distance, race type) — the mark that's still standing today.
  const currentBests = useMemo(() => {
    const map = new Map<string, number>();

    for (const p of pbs) {
      if (p.time_seconds == null) continue;
      const key = `${p.distance_m}-${p.race_type}`;
      const cur = map.get(key);

      if (cur == null || p.time_seconds < cur) {
        map.set(key, p.time_seconds);
      }
    }

    return map;
  }, [pbs]);

  // One entry per distinct event, for the progression chart's event picker.
  const eventOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string; distance_m: number }>();

    for (const p of pbs) {
      if (p.time_seconds == null) continue;
      const key = `${p.distance_m}-${p.race_type}`;

      if (!map.has(key)) {
        map.set(key, {
          key,
          label: `${metersFmt(p.distance_m)} · ${raceTypeLabel(p.race_type)}`,
          distance_m: p.distance_m,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.distance_m - b.distance_m);
  }, [pbs]);

  useEffect(() => {
    if (eventOptions.length === 0) {
      if (selectedEventKey) setSelectedEventKey("");
      return;
    }

    if (!eventOptions.some((opt) => opt.key === selectedEventKey)) {
      setSelectedEventKey(eventOptions[0].key);
    }
  }, [eventOptions, selectedEventKey]);

  const chartData = useMemo(() => {
    if (!selectedEventKey) return [];

    return pbs
      .filter((p) => `${p.distance_m}-${p.race_type}` === selectedEventKey && p.time_seconds != null)
      .slice()
      .sort((a, b) => a.performance_date.localeCompare(b.performance_date))
      .map((p) => ({
        date: p.performance_date,
        seconds: p.time_seconds,
      }));
  }, [pbs, selectedEventKey]);

  const visiblePerformances = showAllPerformances ? pbs : pbs.slice(0, PERFORMANCES_PAGE_SIZE);
  const hiddenCount = Math.max(0, pbs.length - PERFORMANCES_PAGE_SIZE);

  const duplicateCount = previewRows.filter((row) => row.duplicate).length;
  const errorCount = previewRows.filter((row) => row.error).length;
  const insertableRows = previewRows.filter((row) => !row.error && !row.duplicate);

  async function add() {
    const sec = clockToSec(time);

    if (!date || sec == null || Number.isNaN(sec)) {
      toast.error("Date and time required");
      return;
    }

    const { error } = await supabase.from("performances").insert({
      athlete_id: athleteId,
      performance_date: date,
      distance_m: dist,
      time_seconds: sec,
      is_pb: true,
      context: "race",
      notes: "",
      event_name: `${dist}m`,
      age_group: null,
      race_type: "track",
      distance_adjustment_mode: "uniform",
    });

    if (error) {
      toast.error(error.message);
    } else {
      setDate("");
      setTime("");
      onChange();
      toast.success("Added");
    }
  }

  async function remove(id: string) {
    const { error } = await supabase.from("performances").delete().eq("id", id);

    if (error) {
      toast.error(error.message);
      return;
    }

    onChange();
    toast.success("Removed");
  }

  function previewImport() {
    if (!bulkText.trim()) {
      toast.error("Paste performances first");
      return;
    }

    const rows = parseBulkPerformances(bulkText, athleteId).map((row) => ({
      ...row,
      duplicate: !row.error && existingKeys.has(performanceKey(row)),
    }));

    console.log("Bulk import parsed rows", rows.slice(0, 20));

    setPreviewRows(rows);

    const errors = rows.filter((r) => r.error).length;
    const duplicates = rows.filter((r) => r.duplicate).length;
    const insertable = rows.filter((r) => !r.error && !r.duplicate).length;

    if (rows.length === 0) {
      toast.error("No rows detected. Paste the AV results again, including dates.");
      return;
    }

    if (errors > 0) {
      toast.error(`Preview created with ${errors} row issue${errors === 1 ? "" : "s"}`);
    } else {
      toast.success(
        `Preview ready: ${insertable} to import, ${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped`,
      );
    }
  }

  async function bulkImport() {
    if (previewRows.length === 0) {
      previewImport();
      return;
    }

    if (errorCount > 0) {
      toast.error("Fix row errors before importing");
      return;
    }

    if (insertableRows.length === 0) {
      toast.error("No new performances to import");
      return;
    }

    const payload = insertableRows
      .filter((row): row is typeof row & { time_seconds: number } => row.time_seconds != null)
      .map((row) => ({
        athlete_id: row.athlete_id,
        performance_date: row.performance_date,
        distance_m: row.distance_m,
        time_seconds: row.time_seconds,
        is_pb: row.is_pb,
        context: row.context,
        notes: row.notes,
        event_name: row.event_name,
        age_group: row.age_group,
        race_type: row.race_type,
        distance_adjustment_mode: row.distance_adjustment_mode,
      }));

    setImporting(true);

    const { error } = await supabase.from("performances").insert(payload);

    setImporting(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(`Imported ${payload.length} performance${payload.length === 1 ? "" : "s"}`);
    setBulkText("");
    setPreviewRows([]);
    onChange();
  }

  function clearBulk() {
    setBulkText("");
    setPreviewRows([]);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal bests & performances</CardTitle>
        <CardDescription>
          The physiological profile uses 1500m + 5000m to derive pace zones, plus 200/400m for speed reserve.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-4 gap-2">
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div>
            <Label className="text-xs">Distance (m)</Label>
            <Input type="number" value={dist} onChange={(e) => setDist(Number(e.target.value))} />
          </div>

          <div>
            <Label className="text-xs">Time (mm:ss)</Label>
            <Input placeholder="4:12" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>

          <div className="flex items-end">
            <Button size="sm" onClick={add} className="w-full">
              Add
            </Button>
          </div>
        </div>

        <div className="space-y-3 border rounded p-3">
          <div>
            <Label className="text-sm font-medium">Bulk import performances</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Paste AV results exactly as copied, or use: YYYY-MM-DD | Event | Performance | Venue
            </p>
          </div>

          <textarea
            className="w-full min-h-40 rounded-md border bg-background px-3 py-2 text-sm font-mono"
            placeholder={`2026-06-28
7.4km (XC Relay)
21:44
Calder Park

2026-05-10
5km (Road)
14:41
Albert Park

2021-12-18
100m
13.22
(2.6)
Geelong`}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
          />

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={previewImport} disabled={!bulkText.trim()}>
              Preview import
            </Button>

            <Button
              size="sm"
              onClick={bulkImport}
              disabled={importing || previewRows.length === 0 || insertableRows.length === 0 || errorCount > 0}
            >
              {importing ? "Importing..." : `Import ${insertableRows.length} performances`}
            </Button>

            <Button size="sm" variant="ghost" onClick={clearBulk}>
              Clear
            </Button>
          </div>

          {previewRows.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Detected: {previewRows.length} rows · {insertableRows.length} new · {duplicateCount} duplicate skipped ·{" "}
                {errorCount} issue{errorCount === 1 ? "" : "s"}
              </div>

              <div className="overflow-x-auto border rounded">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr className="text-left">
                      <th className="px-2 py-2">Date</th>
                      <th className="px-2 py-2">Event</th>
                      <th className="px-2 py-2">Distance</th>
                      <th className="px-2 py-2">Original</th>
                      <th className="px-2 py-2">Seconds</th>
                      <th className="px-2 py-2">Venue</th>
                      <th className="px-2 py-2">Type</th>
                      <th className="px-2 py-2">PB</th>
                      <th className="px-2 py-2">Status</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y">
                    {previewRows.map((row, i) => (
                      <tr
                        key={`${row.performance_date}-${row.event_name}-${i}`}
                        className={row.error ? "bg-destructive/10" : row.duplicate ? "bg-muted/40" : ""}
                      >
                        <td className="px-2 py-2 whitespace-nowrap">{row.performance_date || "—"}</td>
                        <td className="px-2 py-2 min-w-36">{row.source_event || "—"}</td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          {row.distance_m ? metersFmt(row.distance_m) : "—"}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap tabular-nums">{row.source_perf || "—"}</td>
                        <td className="px-2 py-2 whitespace-nowrap tabular-nums">
                          {row.time_seconds == null ? "—" : row.time_seconds}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">{row.source_venue || "—"}</td>
                        <td className="px-2 py-2 whitespace-nowrap">{row.race_type}</td>
                        <td className="px-2 py-2 whitespace-nowrap">{row.is_pb ? "Yes" : "No"}</td>
                        <td className="px-2 py-2 min-w-40">
                          {row.error ? (
                            <span className="text-destructive">{row.error}</span>
                          ) : row.duplicate ? (
                            <span className="text-muted-foreground">Duplicate skipped</span>
                          ) : row.notes ? (
                            <span className="text-muted-foreground">{row.notes}</span>
                          ) : (
                            <span className="text-emerald-600">Ready</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {eventOptions.length > 0 && (
          <div className="space-y-2 border rounded p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label className="text-sm font-medium">Progression</Label>

              <Select value={selectedEventKey} onValueChange={setSelectedEventKey}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Select event" />
                </SelectTrigger>
                <SelectContent>
                  {eventOptions.map((opt) => (
                    <SelectItem key={opt.key} value={opt.key}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {chartData.length > 1 ? (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="date" tickFormatter={formatChartDate} tick={{ fontSize: 11 }} />
                    <YAxis
                      reversed
                      tickFormatter={(v) => secToClock(v)}
                      tick={{ fontSize: 11 }}
                      width={55}
                      domain={["dataMin", "dataMax"]}
                    />
                    <Tooltip formatter={(value: number) => [secToClock(value), "Time"]} />
                    <Line type="monotone" dataKey="seconds" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Need at least 2 performances for this event to chart progression.
              </p>
            )}
          </div>
        )}

        {pbs.length > 0 && (
          <div className="space-y-2">
            <div className="divide-y border rounded">
              {visiblePerformances.map((p) => {
                const key = `${p.distance_m}-${p.race_type}`;
                const bestTime = currentBests.get(key);
                const isCurrentPB = p.time_seconds != null && bestTime != null && p.time_seconds === bestTime;
                const isPastPB = !isCurrentPB && p.is_pb;

                return (
                  <div key={p.id} className="flex justify-between items-center gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 flex items-center flex-wrap gap-x-1">
                      <span>{metersFmt(p.distance_m)}</span>
                      <span> · </span>
                      <span className="tabular-nums">{displaySeconds(p.time_seconds)}</span>
                      <span> · </span>
                      <span className="text-muted-foreground">{p.performance_date}</span>
                      {p.event_name && (
                        <>
                          <span> · </span>
                          <span className="text-muted-foreground">{p.event_name}</span>
                        </>
                      )}
                      {isCurrentPB && (
                        <Badge className="ml-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-200">
                          PB
                        </Badge>
                      )}
                      {isPastPB && (
                        <Badge className="ml-1 bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200">
                          Past PB
                        </Badge>
                      )}
                    </span>

                    <Button variant="ghost" size="sm" onClick={() => remove(p.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>

            {hiddenCount > 0 && (
              <Button size="sm" variant="outline" className="w-full" onClick={() => setShowAllPerformances((v) => !v)}>
                {showAllPerformances ? "Show fewer" : `Show all (${hiddenCount} more)`}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AiAccessCard({ userId, isAthlete, isCoach }: { userId: string; isAthlete: boolean; isCoach: boolean }) {
  const qc = useQueryClient();

  const { data: profile } = useQuery({
    queryKey: ["profile-ai-key", userId],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("anthropic_api_key_last4").eq("id", userId).maybeSingle();
      return data;
    },
  });

  const [key, setKey] = useState("");
  const hasKey = !!profile?.anthropic_api_key_last4;

  async function save() {
    if (!key.trim() || !key.startsWith("sk-")) {
      toast.error("Enter a valid Anthropic API key (sk-...)");
      return;
    }

    const last4 = key.slice(-4);
    const { error } = await supabase
      .from("profiles")
      .update({ anthropic_api_key: key.trim(), anthropic_api_key_last4: last4 })
      .eq("id", userId);

    if (error) {
      toast.error(error.message);
      return;
    }

    setKey("");
    toast.success("AI key saved");
    qc.invalidateQueries({ queryKey: ["profile-ai-key", userId] });
    qc.invalidateQueries({ queryKey: ["ai-access"] });
  }

  async function remove() {
    const { error } = await supabase
      .from("profiles")
      .update({ anthropic_api_key: null, anthropic_api_key_last4: null })
      .eq("id", userId);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("AI key removed");
    qc.invalidateQueries({ queryKey: ["profile-ai-key", userId] });
    qc.invalidateQueries({ queryKey: ["ai-access"] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--accent-red)]" /> AI assistant
        </CardTitle>
        <CardDescription>
          {isCoach
            ? "As a coach, the AI assistant is enabled for you (subject to a daily rate limit). No setup needed."
            : isAthlete
              ? "AI is opt-in for athletes. Paste your own Anthropic API key to enable a chat assistant against your training data. Calls go directly to Anthropic and are billed to you."
              : "AI is available to coaches by default, or to athletes who provide their own Anthropic API key."}
        </CardDescription>
      </CardHeader>

      {!isCoach && (
        <CardContent className="space-y-3">
          {hasKey && (
            <div className="text-sm flex items-center justify-between border rounded px-3 py-2">
              <span>
                Key on file ending <span className="font-mono">…{profile?.anthropic_api_key_last4}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={remove}>
                Remove
              </Button>
            </div>
          )}

          <div className="grid sm:grid-cols-[1fr_auto] gap-2">
            <Input type="password" placeholder="sk-ant-..." value={key} onChange={(e) => setKey(e.target.value)} />
            <Button onClick={save}>{hasKey ? "Replace key" : "Save key"}</Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Get a key at console.anthropic.com. Your key is stored in your profile and only used server-side to call the
            model on your behalf.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
