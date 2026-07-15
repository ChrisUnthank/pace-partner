import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyAthlete, useAuthUser, useMyRawRoles, type AppRole } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { metersFmt, secToClock, clockToSec } from "@/lib/format";
import { toast } from "sonner";
import { Trash2, Sparkles } from "lucide-react";
import { ProfileImageUploader } from "@/components/profile-image-uploader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setStoredUnits } from "@/lib/units";
import { TIMEZONE_OPTIONS, guessLocalTimezone } from "@/lib/timezones";
import { ZoneBoundariesCard } from "@/components/zone-boundaries-card";

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
      const { data } = await supabase.from("athlete_zone_profiles").select("*").eq("athlete_id", athlete!.id).maybeSingle();
      return data;
    },
  });

  const { data: pbs } = useQuery({
    queryKey: ["my-pbs", athlete?.id],
    enabled: !!athlete,
    queryFn: async () => {
      const { data } = await supabase.from("performances").select("*").eq("athlete_id", athlete!.id).order("performance_date", { ascending: false });
      return data ?? [];
    },
  });

  return (
    <AppShell>
      <div className="space-y-6 max-w-2xl">
        <h1 className="text-2xl font-bold">Profile</h1>

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

        {user && <ProfileImageUploader userId={user.id} name={user.user_metadata?.full_name ?? user.email ?? ""} />}
        {user && <RolesCard userId={user.id} roles={roles} email={user.email ?? ""} />}
        {user && <PreferencesCard userId={user.id} />}
        {user && <JoinRequestsInbox userId={user.id} />}
        {user && <AiAccessCard userId={user.id} isAthlete={roles.includes("athlete")} isCoach={roles.includes("coach") || roles.includes("manager")} />}

        {athlete && (
          <>
            <AthleteForm athlete={athlete} />
            <ZoneBoundariesCard athleteId={athlete.id} profile={zones} />
            <PBsCard athleteId={athlete.id} pbs={pbs ?? []} onChange={() => qc.invalidateQueries({ queryKey: ["my-pbs"] })} />
          </>
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
    const { data, error } = await (supabase.rpc as any)("respond_to_join_request", { _request_id: id, _accept: accept });

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
    qc.invalidateQueries