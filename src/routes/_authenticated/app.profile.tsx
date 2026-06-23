import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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

export const Route = createFileRoute("/_authenticated/app/profile")({
  component: Profile,
});

function Profile() {
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRawRoles();
  const { data: athlete } = useMyAthlete();
  const qc = useQueryClient();

  const { data: zones } = useQuery({
    queryKey: ["zones", athlete?.id],
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
          <CardHeader><CardTitle>Account</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div><span className="text-muted-foreground">Email:</span> {user?.email}</div>
            <div><span className="text-muted-foreground">Roles:</span> {roles.join(", ") || "none"}</div>
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
            <ZonesCard athleteId={athlete.id} zones={zones} pbs={pbs ?? []} onChange={() => qc.invalidateQueries({ queryKey: ["zones"] })} />
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
  const [tz, setTz] = useState<string>((profile?.timezone as string) ?? (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC"));
  // Re-sync when query loads
  if (profile && profile.units && profile.units !== units && units === "metric") {
    setUnits(profile.units);
  }
  async function save() {
    const { error } = await supabase.from("profiles").update({ units, timezone: tz }).eq("id", userId);
    if (error) { toast.error(error.message); return; }
    setStoredUnits(units as any);
    toast.success("Preferences saved");
    qc.invalidateQueries({ queryKey: ["my-profile", userId] });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Display preferences</CardTitle>
        <CardDescription>Choose units and time zone used across the app.</CardDescription>
      </CardHeader>
      <CardContent className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label>Units</Label>
          <Select value={units} onValueChange={setUnits}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="metric">Metric (km)</SelectItem>
              <SelectItem value="imperial">Imperial (mi)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Time zone</Label>
          <Input value={tz} onChange={(e) => setTz(e.target.value)} placeholder="e.g. Europe/London" className="mt-1" />
        </div>
        <div className="sm:col-span-2"><Button onClick={save}>Save preferences</Button></div>
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
    if (error) { toast.error(error.message); return; }
    const result = data as any;
    if (result?.ok === false) { toast.error(result.error ?? "Failed"); return; }
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
              <Button size="sm" variant="outline" onClick={() => respond(r.id, false)}>Decline</Button>
              <Button size="sm" onClick={() => respond(r.id, true)}>Accept</Button>
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
      if (error && !error.message.includes("duplicate")) { toast.error(error.message); return; }
      if (r === "athlete") {
        const { data: existing } = await supabase.from("athletes").select("id").eq("user_id", userId).maybeSingle();
        if (!existing) {
          await supabase.from("athletes").insert({ user_id: userId, name: email || "Athlete", created_by: userId });
        }
      }
    } else {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", r);
      if (error) { toast.error(error.message); return; }
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
        <CardDescription>You can be more than one. Turning off Athlete hides athlete-only views but keeps your training data.</CardDescription>
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

  async function save() {
    const { error } = await supabase.from("athletes").update({
      name, primary_event: event || null, dob: dob || null,
      training_age_years: trainingAge === "" ? null : Number(trainingAge),
      hr_max: hrMax === "" ? null : Number(hrMax),
    }).eq("id", athlete.id);
    if (error) toast.error(error.message); else { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["my-athlete"] }); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Athlete details</CardTitle></CardHeader>
      <CardContent className="grid sm:grid-cols-2 gap-3">
        <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label>Primary event</Label><Input value={event} onChange={(e) => setEvent(e.target.value)} placeholder="e.g. 1500m" /></div>
        <div><Label>DOB</Label><Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></div>
        <div><Label>Training age (years)</Label><Input type="number" value={trainingAge} onChange={(e) => setTrainingAge(e.target.value)} /></div>
        <div><Label>HR max</Label><Input type="number" value={hrMax} onChange={(e) => setHrMax(e.target.value)} /></div>
        <div className="sm:col-span-2"><Button onClick={save}>Save</Button></div>
      </CardContent>
    </Card>
  );
}

function PBsCard({ athleteId, pbs, onChange }: { athleteId: string; pbs: any[]; onChange: () => void }) {
  const [date, setDate] = useState("");
  const [dist, setDist] = useState(1500);
  const [time, setTime] = useState("");

  async function add() {
    const sec = clockToSec(time);
    if (!date || !sec) { toast.error("Date and time required"); return; }
    const { error } = await supabase.from("performances").insert({
      athlete_id: athleteId, performance_date: date, distance_m: dist, time_seconds: sec, is_pb: true,
    });
    if (error) toast.error(error.message); else { setTime(""); onChange(); toast.success("Added"); }
  }
  async function remove(id: string) {
    await supabase.from("performances").delete().eq("id", id); onChange();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal bests & performances</CardTitle>
        <CardDescription>The physiological profile uses 1500m + 5000m to derive pace zones, plus 200/400m for speed reserve.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-4 gap-2">
          <div><Label className="text-xs">Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><Label className="text-xs">Distance (m)</Label><Input type="number" value={dist} onChange={(e) => setDist(Number(e.target.value))} /></div>
          <div><Label className="text-xs">Time (mm:ss)</Label><Input placeholder="4:12" value={time} onChange={(e) => setTime(e.target.value)} /></div>
          <div className="flex items-end"><Button size="sm" onClick={add} className="w-full">Add</Button></div>
        </div>
        {pbs.length > 0 && (
          <div className="divide-y border rounded">
            {pbs.map((p) => (
              <div key={p.id} className="flex justify-between items-center px-3 py-2 text-sm">
                <span>{metersFmt(p.distance_m)} · <span className="tabular-nums">{secToClock(p.time_seconds)}</span> · <span className="text-muted-foreground">{p.performance_date}</span> {p.is_pb && <span className="text-xs text-emerald-600 ml-1">PB</span>}</span>
                <Button variant="ghost" size="sm" onClick={() => remove(p.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ZonesCard({ athleteId, zones, pbs, onChange }: { athleteId: string; zones: any; pbs: any[]; onChange: () => void }) {
  const pb1500 = pbs.filter((p) => p.distance_m === 1500).sort((a, b) => a.time_seconds - b.time_seconds)[0];
  const pb5000 = pbs.filter((p) => p.distance_m === 5000).sort((a, b) => a.time_seconds - b.time_seconds)[0];

  async function autoDerive() {
    if (!pb1500 && !pb5000) { toast.error("Add a 1500m or 5000m PB first"); return; }
    const pace1500 = pb1500 ? pb1500.time_seconds / 1.5 : null;
    const pace5k = pb5000 ? pb5000.time_seconds / 5 : (pace1500 ? pace1500 * 1.10 : null);
    const threshold = pace5k ? pace5k * 1.06 : null;
    const easy = pace5k ? pace5k * 1.25 : null;
    const rep = pace1500 ? pace1500 * 0.97 : null;

    const { error } = await supabase.from("athlete_zone_profiles").upsert({
      athlete_id: athleteId,
      pace_1500_sec_per_km: pace1500,
      pace_5k_sec_per_km: pace5k,
      pace_threshold_sec_per_km: threshold,
      pace_easy_sec_per_km: easy,
      pace_rep_sec_per_km: rep,
      auto_derived: true,
    });
    if (error) toast.error(error.message); else { toast.success("Zones derived"); onChange(); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pace zones</CardTitle>
        <CardDescription>Auto-derived from your 1500m and 5000m PBs. Coach can override later.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Row label="1500m pace" v={zones?.pace_1500_sec_per_km} />
          <Row label="5k pace" v={zones?.pace_5k_sec_per_km} />
          <Row label="Threshold" v={zones?.pace_threshold_sec_per_km} />
          <Row label="Easy" v={zones?.pace_easy_sec_per_km} />
          <Row label="Rep" v={zones?.pace_rep_sec_per_km} />
        </div>
        <Button variant="outline" onClick={autoDerive}>Auto-derive from PBs</Button>
      </CardContent>
    </Card>
  );
}
function Row({ label, v }: { label: string; v?: number | null }) {
  return (
    <div className="flex justify-between border rounded px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{v ? `${secToClock(v)} /km` : "—"}</span>
    </div>
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
    if (!key.trim() || !key.startsWith("sk-")) { toast.error("Enter a valid Anthropic API key (sk-...)"); return; }
    const last4 = key.slice(-4);
    const { error } = await supabase.from("profiles").update({ anthropic_api_key: key.trim(), anthropic_api_key_last4: last4 }).eq("id", userId);
    if (error) { toast.error(error.message); return; }
    setKey(""); toast.success("AI key saved");
    qc.invalidateQueries({ queryKey: ["profile-ai-key", userId] });
    qc.invalidateQueries({ queryKey: ["ai-access"] });
  }
  async function remove() {
    const { error } = await supabase.from("profiles").update({ anthropic_api_key: null, anthropic_api_key_last4: null }).eq("id", userId);
    if (error) { toast.error(error.message); return; }
    toast.success("AI key removed");
    qc.invalidateQueries({ queryKey: ["profile-ai-key", userId] });
    qc.invalidateQueries({ queryKey: ["ai-access"] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-[var(--accent-red)]" /> AI assistant</CardTitle>
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
              <span>Key on file ending <span className="font-mono">…{profile?.anthropic_api_key_last4}</span></span>
              <Button variant="ghost" size="sm" onClick={remove}>Remove</Button>
            </div>
          )}
          <div className="grid sm:grid-cols-[1fr_auto] gap-2">
            <Input type="password" placeholder="sk-ant-..." value={key} onChange={(e) => setKey(e.target.value)} />
            <Button onClick={save}>{hasKey ? "Replace key" : "Save key"}</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Get a key at console.anthropic.com. Your key is stored in your profile and only used server-side to call the model on your behalf.
          </p>
        </CardContent>
      )}
    </Card>
  );
}