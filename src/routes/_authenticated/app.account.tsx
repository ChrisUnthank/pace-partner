import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyRawRoles, type AppRole } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Sparkles, User2 } from "lucide-react";
import { ProfileImageUploader } from "@/components/profile-image-uploader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setStoredUnits } from "@/lib/units";
import { TIMEZONE_OPTIONS, guessLocalTimezone } from "@/lib/timezones";
import { ContactDetailsCard } from "@/components/contact-details-card";
import { Link } from "@tanstack/react-router";
import { UserCircle2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/account")({
  component: Account,
});

function Account() {
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRawRoles();
  const isAthlete = roles.includes("athlete");

  return (
    <AppShell fullWidth>
      <div className="space-y-6 max-w-6xl">
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
            style={{ background: "var(--accent-red)" }}
          >
            <User2 className="h-5 w-5 text-white" strokeWidth={2} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Account</div>
            <h1 className="text-2xl font-bold leading-tight">Account</h1>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Left column: athlete details up top, roles underneath, AI fills the gap */}
          <div className="space-y-6">
            {/* Athlete-specific training data (Identity, Goals, Zones,
                Seasons) lives on the athlete's own Athlete Info page now,
                not here — Account is login/settings/subscription only.
                This card is purely a discoverability pointer since that
                content used to live on this exact page. */}
            {isAthlete && (
              <Card>
                <CardContent className="pt-6">
                  <Link
                    to="/app/athlete-info"
                    className="flex items-center gap-3 group"
                  >
                    <div
                      className="h-9 w-9 shrink-0 rounded-lg grid place-items-center"
                      style={{ background: "var(--accent-red)" }}
                    >
                      <UserCircle2 className="h-4.5 w-4.5 text-white" strokeWidth={2} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold group-hover:underline">Athlete Info</div>
                      <div className="text-xs text-muted-foreground">
                        Identity, physiological metrics, goals, and season windows
                      </div>
                    </div>
                  </Link>
                </CardContent>
              </Card>
            )}
            {/* Self-service contact details — feeds the coach's address book.
                Shown to every signed-in user (athlete or parent alike). */}
            {user && <ContactDetailsCard userId={user.id} />}
            {user && <RolesCard userId={user.id} roles={roles} email={user.email ?? ""} />}
            {user && (
              <AiAccessCard
                userId={user.id}
                isAthlete={roles.includes("athlete")}
                isCoach={roles.includes("coach") || roles.includes("manager")}
              />
            )}
            {user && <JoinRequestsInbox userId={user.id} />}
          </div>

          {/* Right column: account & photo up top, then change password, preferences underneath */}
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

            {user && <ProfileImageUploader userId={user.id} name={user.user_metadata?.full_name ?? user.email ?? ""} />}

            <ChangePasswordCard />

            {user && <PreferencesCard userId={user.id} />}
          </div>
        </div>
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
        <CardDescription>Update the password used to sign in. You're already signed in, so no need to enter the old one.</CardDescription>
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
