import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyRawRoles, useMyAthlete, type AppRole } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { athleteDisplayName, derivedGreetingName } from "@/lib/athlete-name";
import { Sparkles, User2, History } from "lucide-react";
import { ProfileImageUploader } from "@/components/profile-image-uploader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setStoredUnits } from "@/lib/units";
import { TIMEZONE_OPTIONS, guessLocalTimezone } from "@/lib/timezones";
import { ContactDetailsCard } from "@/components/contact-details-card";
import { IdentifiersCard } from "@/components/copyable-id";
import { Link } from "@tanstack/react-router";
import { UserCircle2, Moon, SunMedium, Palette, Lock } from "lucide-react";
import type { Appearance } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { logAccountActivity } from "@/lib/account-activity-log";
import { useTheme } from "@/lib/theme";
import { useBranding } from "@/lib/branding";
import { PoweredByStrider } from "@/components/brand-logo";
import { PwaInstallPrompt } from "@/components/pwa-install-card";

export const Route = createFileRoute("/_authenticated/app/account")({
  component: Account,
});

function Account() {
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRawRoles();
  const isAthlete = roles.includes("athlete");
  const isCoach = roles.includes("coach") || roles.includes("manager");

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
            {/* Same discoverability-pointer pattern as the Athlete Info card
                above — Branding is a whole page of its own, this is just the
                signpost from the place people go looking for settings. */}
            {isCoach && (
              <Card>
                <CardContent className="pt-6">
                  <Link to="/app/branding" className="flex items-center gap-3 group">
                    <div
                      className="h-9 w-9 shrink-0 rounded-lg grid place-items-center"
                      style={{ background: "var(--accent-red)" }}
                    >
                      <Palette className="h-4.5 w-4.5 text-[var(--primary-foreground)]" strokeWidth={2} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold group-hover:underline">Branding</div>
                      <div className="text-xs text-muted-foreground">
                        Put your own name, logo, and colour on the app — for you and your athletes
                      </div>
                    </div>
                  </Link>
                </CardContent>
              </Card>
            )}

            {/* Self-service contact details — feeds the coach's address book.
                Shown to every signed-in user (athlete or parent alike). */}
            {user && <ContactDetailsCard userId={user.id} />}
            {isAthlete && <InviteParentCard />}
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
              <CardContent className="text-sm space-y-3">
                <div className="space-y-1">
                  <div>
                    <span className="text-muted-foreground">Email:</span> {user?.email}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Roles:</span> {roles.join(", ") || "none"}
                  </div>
                </div>
                {user && <PreferredNameField userId={user.id} />}
              </CardContent>
            </Card>

            {/* Deliberate settings-page home for someone who goes looking
                for this — the app-shell also offers it unprompted as a
                dismissible banner on a mobile browser tab, but this card
                always renders regardless of dismissal state. */}
            <PwaInstallPrompt variant="card" />

            {user && <ProfileImageUploader userId={user.id} name={user.user_metadata?.full_name ?? user.email ?? ""} />}

            <ChangePasswordCard userId={user?.id} />

            {user && <PreferencesCard userId={user.id} />}

            {user && <AccountIdentifiers userId={user.id} />}
          </div>
        </div>

        {user && <AccountActivityLogCard userId={user.id} />}

        {/* Second, always-visible home for the non-removable attribution —
            the sidebar copy is hidden while the sidebar is collapsed, and
            on mobile there's no sidebar at all. Renders nothing on an
            unbranded install. */}
        <PoweredByStrider className="px-0 pt-2" />
      </div>
    </AppShell>
  );
}

// Thin wrapper: the shared IdentifiersCard takes plain values, so the athlete
// lookup lives here rather than inside a presentational component.
function AccountIdentifiers({ userId }: { userId: string }) {
  const { data: athlete } = useMyAthlete();
  return (
    <IdentifiersCard
      variant="account"
      userId={userId}
      athleteId={athlete?.id}
      athleteName={athlete?.name}
    />
  );
}

function PreferencesCard({ userId }: { userId: string }) {
  const qc = useQueryClient();
  // Appearance is a pure client-side UI preference (this device only, via
  // localStorage) — same pattern as the existing Coach/Athlete view-mode
  // toggle in view-mode.tsx, not synced to the profiles row like
  // units/timezone below. Applies instantly, no Save button needed.
  const { appearance, setAppearance, isLockedByBrand, brandTintAvailable } = useTheme();
  const { appName } = useBranding();

  // Brand Dark / Brand Light keep the same light/dark structure but tint
  // every surface toward the coach's brand hue. Only offered when a brand
  // colour actually exists — otherwise they'd be two options that do nothing.
  const appearanceOptions: { value: Appearance; label: string; icon: typeof Moon }[] = [
    { value: "dark", label: "Dark", icon: Moon },
    { value: "light", label: "Light", icon: SunMedium },
    ...(brandTintAvailable
      ? ([
          { value: "brand-dark", label: `${appName} Dark`, icon: Moon },
          { value: "brand-light", label: `${appName} Light`, icon: SunMedium },
        ] as { value: Appearance; label: string; icon: typeof Moon }[])
      : []),
  ];

  const { data: profile } = useQuery({
    queryKey: ["my-profile", userId],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("units, timezone").eq("id", userId).maybeSingle();
      return data;
    },
  });

  const [units, setUnits] = useState<string>((profile?.units as string) ?? "metric");
  const [tz, setTz] = useState<string>((profile?.timezone as string) ?? guessLocalTimezone());
  // Guards the one-time sync below so it only ever pulls the saved value
  // in FROM the database once, right after it loads — never again after
  // that. The previous version re-ran this check on every render and only
  // fired when the local `units` value happened to currently equal
  // "metric", which meant picking "Metric" in the dropdown when the saved
  // preference was "Imperial" got silently snapped back to Imperial on
  // the very next render, before Save could ever be clicked — the bug
  // this was reported as. A plain useEffect that only runs once when the
  // query first resolves has no such directional bias.
  const [syncedFromProfile, setSyncedFromProfile] = useState(false);

  useEffect(() => {
    if (profile && !syncedFromProfile) {
      setUnits((profile.units as string) ?? "metric");
      setTz((profile.timezone as string) ?? guessLocalTimezone());
      setSyncedFromProfile(true);
    }
  }, [profile, syncedFromProfile]);

  async function save() {
    const { error } = await supabase.from("profiles").update({ units, timezone: tz }).eq("id", userId);

    if (error) {
      toast.error(error.message);
      return;
    }

    setStoredUnits(units as any);
    toast.success("Preferences saved");
    qc.invalidateQueries({ queryKey: ["my-profile", userId] });
    logAccountActivity(userId, "preferences_updated", `Display preferences updated (${units}, ${tz})`, { units, timezone: tz });
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
        <div className="sm:col-span-2">
          <Label>Appearance</Label>
          {/* A white-labelling coach can LOCK their squad to one appearance
              (coach_branding.force_theme). When they have, this picker is
              disabled rather than hidden — silently removing a control
              someone used yesterday is more confusing than showing it
              greyed out with a reason. */}
          <div className={cn("mt-1 flex flex-wrap gap-1", isLockedByBrand && "opacity-60")}>
            {appearanceOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                disabled={isLockedByBrand}
                onClick={() => setAppearance(o.value)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                  isLockedByBrand && "cursor-not-allowed",
                  appearance === o.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <o.icon className="h-3.5 w-3.5" />
                {o.label}
              </button>
            ))}
          </div>
          {isLockedByBrand ? (
            <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1.5">
              <Lock className="h-3 w-3 shrink-0 mt-0.5" />
              {appName} has set a fixed appearance for everyone.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-1">
              This device only — applies right away.
              {brandTintAvailable && ` The ${appName} options tint every panel toward the brand colour.`}
            </p>
          )}
        </div>

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

function ChangePasswordCard({ userId }: { userId: string | undefined }) {
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
    if (userId) logAccountActivity(userId, "password_changed", "Password changed");
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

// Self-service equivalent of the coach Roster page's "Invite Parent"
// button — lets an athlete invite their own parent/guardian directly,
// without needing a coach to do it for them (an athlete may not have a
// coach yet, or may simply want to send it themselves). Goes through the
// create_parent_invite RPC rather than a raw table insert since
// parent_invites.coach_user_id may need to be null here (no coach in the
// loop) and this keeps that authorization check server-side rather than
// relying on an RLS policy this component can't see.
function InviteParentCard() {
  const { data: athlete } = useMyAthlete();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [lastLink, setLastLink] = useState<string | null>(null);

  async function send() {
    if (!athlete?.id) return;
    if (!email.trim() || !email.includes("@")) {
      toast.error("Enter a valid email address");
      return;
    }

    setSending(true);
    const { data, error } = await (supabase.rpc as any)("create_parent_invite", {
      _athlete_id: athlete.id,
      _email: email.trim(),
    });
    setSending(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    const res = data as { ok: boolean; token?: string; error?: string };
    if (!res.ok || !res.token) {
      toast.error(
        res.error === "not_authorized" ? "Couldn't create that invite for this account." : res.error ?? "Failed",
      );
      return;
    }

    const link = `${window.location.origin}/claim/${res.token}`;
    setLastLink(link);
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Invite link copied — send it to your parent/guardian");
    } catch {
      toast.success("Invite created");
    }
    setEmail("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Invite a parent or guardian</CardTitle>
        <CardDescription>
          They'll get read-only access to your schedule and results through the Parent Portal.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[200px]">
          <Label className="text-xs">Their email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="parent@example.com" />
        </div>
        <Button onClick={send} disabled={sending || !athlete?.id}>
          {sending ? "Sending…" : "Send invite"}
        </Button>
        {lastLink && (
          <p className="w-full text-xs text-muted-foreground break-all">Link copied: {lastLink}</p>
        )}
      </CardContent>
    </Card>
  );
}

function RolesCard({ userId, roles, email }: { userId: string; roles: AppRole[]; email: string }) {
  const qc = useQueryClient();
  const has = (r: AppRole) => roles.includes(r);

  async function toggle(r: "athlete" | "coach" | "manager" | "parent", on: boolean) {
    // Matches the disabled checkbox below — belt-and-suspenders in case
    // this ever gets called some other way. Real enforcement still needs
    // to live in RLS once the premium-plan check exists server-side;
    // this alone doesn't stop a direct API call.
    if (r === "coach" && on && !has("coach")) {
      toast.error("Coach access requires a premium plan — get in touch to upgrade.");
      return;
    }

    if (on) {
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: r });

      if (error && !error.message.includes("duplicate")) {
        toast.error(error.message);
        return;
      }

      if (r === "athlete") {
        // Same claim-before-create order as the sign-up page. Turning the
        // Athlete role on here reached the identical bug: the lookup is on
        // user_id, a coach-created record has user_id NULL, so an invited
        // athlete got a second record from this path too.
        const { data: claimed } = await supabase.rpc("claim_athlete_invite_by_email" as any);
        const claimedId = (claimed as any)?.athlete_id ?? null;

        if (!claimedId) {
          const { data: existing } = await supabase.from("athletes").select("id").eq("user_id", userId).maybeSingle();

          if (!existing) {
            // Was `name: email || "Athlete"`, which wrote the whole address
            // into the name column — the reason athlete records exist called
            // "amanda@unthank.me". Shared helper so the three creation paths
            // cannot disagree again.
            await supabase.from("athletes").insert({
              user_id: userId,
              name: athleteDisplayName(null, email),
              created_by: userId,
            });
          }
        }
      }
    } else {
      // Turning the Athlete role OFF used to leave the athlete record behind.
      //
      // The record is created when the role goes on, so it should go when the
      // role comes off — otherwise a manager or parent who was briefly an
      // athlete keeps a stray record forever. That is where the empty
      // "amanda@unthank.me" athlete came from: role on, record created, role
      // off, record orphaned.
      //
      // Only when it is genuinely EMPTY. A record with training on it is
      // somebody's history and must survive a role change — a coach who stops
      // logging their own running still wants the last two years of it.
      if (r === "athlete") {
        const { data: mine } = await supabase
          .from("athletes")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle();

        if (mine?.id) {
          const [{ count: sessionCount }, { count: perfCount }] = await Promise.all([
            supabase.from("sessions").select("id", { count: "exact", head: true }).eq("athlete_id", mine.id),
            supabase.from("performances").select("id", { count: "exact", head: true }).eq("athlete_id", mine.id),
          ]);

          if ((sessionCount ?? 0) === 0 && (perfCount ?? 0) === 0) {
            await supabase.from("athletes").delete().eq("id", mine.id);
          } else {
            // Said out loud rather than silently kept, so nobody wonders later
            // why a non-athlete still appears in an athlete picker.
            toast.info(
              `Athlete role removed. The athlete profile was kept because it holds ${sessionCount ?? 0} session(s) — delete it from Manage Athletes if it is not wanted.`,
            );
          }
        }
      }

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

  const items: { role: "athlete" | "coach" | "manager" | "parent"; label: string; desc: string }[] = [
    { role: "athlete", label: "Athlete", desc: "See your own training, check-ins, PBs and readiness." },
    { role: "coach", label: "Coach", desc: "Manage your linked roster of athletes, sessions and templates." },
    { role: "manager", label: "Manager", desc: "Team / squad administrator — coach-level access to every athlete." },
    { role: "parent", label: "Parent", desc: "Follow a linked athlete's training and check-ins from a parent's view." },
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
        {items.map((it) => {
          // Coach is a premium plan — self-service can only ever turn it
          // OFF for someone who already has it (e.g. downgrading), never
          // ON from Athlete/Parent/Manager. This is a UI-level guard only;
          // it stops the toggle here but doesn't by itself stop a direct
          // API call, so the real boundary still needs to live in RLS (or
          // wherever the eventual subscription check runs) once that
          // exists — flagging that rather than implying this closes it.
          const isLockedCoach = it.role === "coach" && !has("coach");

          return (
            <label
              key={it.role}
              className={cn("flex items-start gap-3", isLockedCoach ? "cursor-not-allowed" : "cursor-pointer")}
            >
              <Checkbox
                checked={has(it.role)}
                disabled={isLockedCoach}
                onCheckedChange={(v) => toggle(it.role, !!v)}
                className="mt-0.5"
              />
              <div>
                <div className="text-sm font-medium flex items-center gap-1.5">
                  {it.label}
                  {isLockedCoach && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground border border-border rounded px-1.5 py-0.5">
                      Premium
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {isLockedCoach ? "Coach access requires a premium plan — get in touch to upgrade." : it.desc}
                </div>
              </div>
            </label>
          );
        })}
      </CardContent>
    </Card>
  );
}

function AiAccessCard({ userId, isAthlete, isCoach }: { userId: string; isAthlete: boolean; isCoach: boolean }) {
  // BYO-Anthropic-key setup has been removed — athletes now get AI access
  // through the same Lovable AI Gateway coaches use, gated by
  // profiles.ai_subscription_active (currently defaulted ON for every
  // athlete; there's no billing/paywall UI yet, so this card is
  // deliberately just a status readout, not a toggle — nothing here for
  // an athlete to turn on/off themselves until that exists).
  const { data: profile } = useQuery({
    queryKey: ["profile-ai-subscription", userId],
    enabled: isAthlete && !isCoach,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("profiles")
        .select("ai_subscription_active")
        .eq("id", userId)
        .maybeSingle();
      return data;
    },
  });

  const subscriptionActive = profile?.ai_subscription_active !== false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--accent-red)]" /> AI assistant
        </CardTitle>
        <CardDescription>
          {isCoach
            ? "The AI assistant is enabled for you as a coach (subject to a daily rate limit). No setup needed."
            : isAthlete
              ? subscriptionActive
                ? "AI is enabled for your account (subject to a daily rate limit) — chat with your AI coach and generate reviews from wherever you see the AI Coach card."
                : "AI access on your account is currently inactive. Contact your coach if you believe this is a mistake."
              : "AI is available to coaches, and to athletes with an active subscription."}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

// New, separate system log — distinct from Athlete History's training
// activity feed (that one stays exactly where it is, untouched). This
// is account-level activity only (password changes, preference
// updates, and whatever else gets wired up over time), private to the
// account it belongs to. Kept for 1 month, then shown as "Archived"
// for 3 more (a display-only distinction by age, not a physical move —
// both live in the same table), then a daily job hard-deletes anything
// past 4 months total so this never just grows forever.
const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function AccountActivityLogCard({ userId }: { userId: string }) {
  const { data: entries, isLoading } = useQuery({
    queryKey: ["account-activity-log", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_activity_log" as any)
        .select("id, action, description, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; action: string; description: string; created_at: string }[];
    },
  });

  const cutoff = Date.now() - ONE_MONTH_MS;
  const recent = (entries ?? []).filter((e) => new Date(e.created_at).getTime() >= cutoff);
  const archived = (entries ?? []).filter((e) => new Date(e.created_at).getTime() < cutoff);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-4 w-4 text-[var(--accent-red)]" /> Account activity log
        </CardTitle>
        <CardDescription>
          A record of activity on this account — password changes, preference updates, and similar. Kept for 1
          month, archived for 3 more, then removed automatically. Private to this account; not visible to your
          coach or athletes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !entries || entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
        ) : (
          <div className="space-y-4">
            {recent.length > 0 && (
              <div className="divide-y">
                {recent.map((e) => (
                  <AccountLogRow key={e.id} entry={e} />
                ))}
              </div>
            )}
            {archived.length > 0 && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Archived
                </div>
                <div className="divide-y opacity-60">
                  {archived.map((e) => (
                    <AccountLogRow key={e.id} entry={e} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AccountLogRow({ entry }: { entry: { description: string; created_at: string } }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span>{entry.description}</span>
      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
        {new Date(entry.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
      </span>
    </div>
  );
}


/**
 * What the app calls you.
 *
 * The greeting used to take the first word of profiles.full_name and there
 * was no way to correct it — full_name is never editable anywhere, it arrives
 * from sign-up metadata and stays. So someone called Michael who goes by Mike
 * was stuck with Michael.
 *
 * Left blank it stays NULL rather than storing the derived name, so "no
 * preference" and "chose the same as the derived name" remain different
 * things — and the placeholder shows what will be used instead, so the empty
 * box explains itself.
 */
function PreferredNameField({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [value, setValue] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["preferred-name", userId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("profiles")
        .select("preferred_name, full_name")
        .eq("id", userId)
        .maybeSingle();
      return data ?? null;
    },
  });

  useEffect(() => {
    if (profile && value === null) setValue((profile as any).preferred_name ?? "");
  }, [profile, value]);

  const derived = derivedGreetingName((profile as any)?.full_name);

  async function save() {
    setSaving(true);
    const trimmed = (value ?? "").trim();
    const { error } = await (supabase as any)
      .from("profiles")
      // Blank saves as NULL, not "". One representation of "not set", so the
      // fallback behaves the same however the field was cleared.
      .update({ preferred_name: trimmed === "" ? null : trimmed })
      .eq("id", userId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(trimmed ? `You'll be greeted as "${trimmed}"` : "Using your first name");
    qc.invalidateQueries({ queryKey: ["preferred-name", userId] });
    qc.invalidateQueries({ queryKey: ["my-profile-image", userId] });
  }

  return (
    <div className="space-y-1.5 pt-2 border-t">
      <Label htmlFor="preferred-name" className="text-xs">
        Preferred name
      </Label>
      <div className="flex gap-2">
        <Input
          id="preferred-name"
          value={value ?? ""}
          onChange={(e) => setValue(e.target.value)}
          placeholder={derived || "Your name"}
          className="h-8 text-sm"
        />
        <Button size="sm" variant="outline" className="h-8" disabled={saving} onClick={save}>
          Save
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {derived
          ? `Used in greetings. Leave blank to use "${derived}".`
          : "Used in greetings."}
      </p>
    </div>
  );
}
