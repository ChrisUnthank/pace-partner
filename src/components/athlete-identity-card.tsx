import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TIMEZONE_OPTIONS, guessLocalTimezone } from "@/lib/timezones";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

// Single source of truth for athlete-identity fields (name/gender/DOB/HR/
// timezone/etc). Both app.athletes.$athleteId.tsx (the main profile page)
// and app.athletes.$athleteId_.performance-profile.tsx (Athlete
// Information tab) render this same component, so there's only one form
// to keep correct — the two pages can no longer drift apart on which
// fields are editable, since it's the same code either place. Both pagesF
// also query the athlete row under the same ["athlete", athleteId] key,
// so a save on either page invalidates and refreshes both.

export const ATHLETE_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "injured", label: "Injured" },
  { value: "off_season", label: "Off-season" },
  { value: "on_hiatus", label: "On hiatus" },
  { value: "retired", label: "Retired" },
];

export const ATHLETE_STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700 border-emerald-200",
  injured: "bg-rose-100 text-rose-700 border-rose-200",
  off_season: "bg-muted text-muted-foreground border-border",
  on_hiatus: "bg-amber-100 text-amber-700 border-amber-200",
  retired: "bg-muted text-muted-foreground border-border",
};

export function AthleteIdentityCard({
  athlete,
  athleteId,
  canEdit,
  rollingActuals,
}: {
  athlete: any;
  athleteId: string;
  // True if the current user is either this athlete's coach OR the
  // athlete themself — matches the athletes table's own RLS update policy
  // (`user_id = auth.uid() OR is_coach_of(...)`) exactly, so the Edit
  // button's visibility never promises something the database would then
  // refuse to save.
  canEdit: boolean;
  // Optional last-28-days rollup — only the Performance Profile page
  // currently fetches this; the main profile page passes nothing and the
  // line simply doesn't show, rather than this card doing a duplicate
  // fetch of the same data both pages would otherwise need separately.
  rollingActuals?: { totalKm: number; weeklyAvgKm: number; sessionCount: number } | null;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [gender, setGender] = useState(athlete?.sex ?? "");
  const [dob, setDob] = useState(athlete?.dob ?? "");
  const [height, setHeight] = useState(athlete?.height_cm != null ? String(athlete.height_cm) : "");
  const [primaryEvent, setPrimaryEvent] = useState(athlete?.primary_event ?? "");
  const [secondaryEvents, setSecondaryEvents] = useState((athlete?.secondary_events ?? []).join(", "));
  const [trainingAge, setTrainingAge] = useState(
    athlete?.training_age_years != null ? String(athlete.training_age_years) : "",
  );
  const [frequency, setFrequency] = useState(
    athlete?.typical_training_frequency != null ? String(athlete.typical_training_frequency) : "",
  );
  const [club, setClub] = useState(athlete?.club ?? "");
  const [status, setStatus] = useState(athlete?.athlete_status ?? "active");
  const [hrMax, setHrMax] = useState(athlete?.hr_max != null ? String(athlete.hr_max) : "");
  const [hrRest, setHrRest] = useState(athlete?.hr_rest != null ? String(athlete.hr_rest) : "");
  const [timezone, setTimezone] = useState(athlete?.timezone ?? guessLocalTimezone());

  const { data: latestVitals } = useQuery({
    queryKey: ["latest_vitals", athleteId],
    queryFn: async () => {
      const { data } = await supabase
        .from("daily_vitals" as any)
        .select("weight_kg, vitals_date")
        .eq("athlete_id", athleteId)
        .not("weight_kg", "is", null)
        .order("vitals_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as any;
    },
  });

  const weightDisplay =
    latestVitals?.weight_kg != null
      ? `${Number(latestVitals.weight_kg).toFixed(1)} kg`
      : athlete?.weight != null
        ? `${Number(athlete.weight).toFixed(1)} kg (baseline)`
        : "not yet logged";

  // This athlete's own account-level display timezone (profiles.timezone),
  // fetched purely to power the mismatch warning below — this card never
  // reads or writes this value otherwise. Only queried when the athlete
  // actually has a linked login (user_id); an athlete with no account yet
  // has nothing to compare against.
  const { data: linkedProfile } = useQuery({
    queryKey: ["athlete-linked-profile-timezone", athlete?.user_id],
    enabled: !!athlete?.user_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("timezone")
        .eq("id", athlete.user_id)
        .maybeSingle();
      return data;
    },
  });

  // Two separate timezone settings exist in this app on purpose (account
  // display preference vs. session classification), but that's a genuine
  // footgun — someone setting one reasonably assumes it covers both. Flag
  // it rather than let it silently produce wrong session dates/titles on
  // every FIT upload. Only fires when both values are actually present and
  // differ — an athlete who's never touched either field isn't "wrong,"
  // just unset.
  const timezoneMismatch =
    !!athlete?.timezone &&
    !!linkedProfile?.timezone &&
    athlete.timezone !== linkedProfile.timezone;

  const ageYears = athlete?.dob
    ? Math.floor((Date.now() - new Date(athlete.dob).getTime()) / (365.25 * 24 * 3600 * 1000))
    : null;

  function startEditing() {
    // Re-sync every field from the current athlete row when entering edit
    // mode, in case it changed (e.g. saved from the other page) since this
    // component last mounted.
    setGender(athlete?.sex ?? "");
    setDob(athlete?.dob ?? "");
    setHeight(athlete?.height_cm != null ? String(athlete.height_cm) : "");
    setPrimaryEvent(athlete?.primary_event ?? "");
    setSecondaryEvents((athlete?.secondary_events ?? []).join(", "));
    setTrainingAge(athlete?.training_age_years != null ? String(athlete.training_age_years) : "");
    setFrequency(athlete?.typical_training_frequency != null ? String(athlete.typical_training_frequency) : "");
    setClub(athlete?.club ?? "");
    setStatus(athlete?.athlete_status ?? "active");
    setHrMax(athlete?.hr_max != null ? String(athlete.hr_max) : "");
    setHrRest(athlete?.hr_rest != null ? String(athlete.hr_rest) : "");
    setTimezone(athlete?.timezone ?? guessLocalTimezone());
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("athletes")
      .update({
        sex: gender || null,
        dob: dob || null,
        height_cm: height ? Number(height) : null,
        primary_event: primaryEvent.trim() || null,
        secondary_events: secondaryEvents
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean),
        training_age_years: trainingAge ? Number(trainingAge) : null,
        typical_training_frequency: frequency ? Number(frequency) : null,
        club: club.trim() || null,
        athlete_status: status,
        hr_max: hrMax ? Number(hrMax) : null,
        hr_rest: hrRest ? Number(hrRest) : null,
        timezone,
      } as any)
      .eq("id", athleteId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Athlete information updated");
    setEditing(false);
    // Both pages query the athlete row under this same key — invalidating
    // it here means whichever page you visit next (or the other page, if
    // it happens to still be mounted) picks up the change without a
    // manual refresh.
    qc.invalidateQueries({ queryKey: ["athlete", athleteId] });
    // Also invalidate useMyAthlete's key (["my-athlete", userId]) — used
    // only by the self-service Profile page (app.account.tsx), which
    // fetches the athlete row a different way (by user_id, not athleteId).
    // Invalidating a prefix with no matching active query elsewhere is a
    // harmless no-op, so this is safe to always do rather than needing an
    // extra prop just for that one page.
    qc.invalidateQueries({ queryKey: ["my-athlete"] });
    qc.invalidateQueries({ queryKey: ["athlete-linked-profile-timezone", athlete?.user_id] });
  }

  const rows: Array<[string, string]> = [
    ["Name", athlete?.name ?? "—"],
    ["Gender", athlete?.sex ?? "—"],
    ["Date of birth", athlete?.dob ? `${athlete.dob}${ageYears != null ? ` (${ageYears}y)` : ""}` : "—"],
    ["Height", athlete?.height_cm != null ? `${athlete.height_cm} cm` : "—"],
    ["Primary event", athlete?.primary_event ?? "—"],
    ["Secondary events", (athlete?.secondary_events ?? []).length ? athlete.secondary_events.join(", ") : "—"],
    ["Training age", athlete?.training_age_years != null ? `${athlete.training_age_years} yrs` : "—"],
    ["Typical training frequency", athlete?.typical_training_frequency != null ? `${athlete.typical_training_frequency}/week` : "—"],
    ["Club", athlete?.club ?? "—"],
    ["Weight", weightDisplay],
    ["HR max", athlete?.hr_max != null ? `${athlete.hr_max} bpm` : "—"],
    ["HR rest", athlete?.hr_rest != null ? `${athlete.hr_rest} bpm` : "—"],
    ["Time zone", athlete?.timezone ?? "—"],
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">Athlete Information</CardTitle>
          {rollingActuals ? (
            <CardDescription>
              Last 28 days actual: {rollingActuals.totalKm.toFixed(0)} km · {rollingActuals.sessionCount} sessions (
              {rollingActuals.weeklyAvgKm.toFixed(0)} km/wk avg)
            </CardDescription>
          ) : (
            <CardDescription>Age and Weight are calculated automatically — edit Date of birth and log Vitals to update them.</CardDescription>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className={ATHLETE_STATUS_STYLES[athlete?.athlete_status ?? "active"]}>
            {ATHLETE_STATUS_OPTIONS.find((o) => o.value === athlete?.athlete_status)?.label ?? "Active"}
          </Badge>
          {canEdit && !editing && (
            <Button size="sm" variant="outline" onClick={startEditing}>
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {timezoneMismatch && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
            <div>
              <span className="font-medium">Time zone mismatch.</span> This athlete's account display time zone is{" "}
              <span className="font-medium">{linkedProfile?.timezone}</span>, but the time zone used below to
              classify FIT uploads (calendar date, Morning/Afternoon/Evening title) is{" "}
              <span className="font-medium">{athlete?.timezone}</span>. If {athlete?.timezone} isn't actually
              correct, update the "Time zone" field below — it's the one that matters for session dates, not the
              account display setting.
            </div>
          </div>
        )}
        {!editing ? (
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between border-b py-1">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-medium tabular-nums text-right">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Gender</Label>
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Not set" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Date of birth</Label>
                <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">HR max (bpm)</Label>
                <Input type="number" value={hrMax} onChange={(e) => setHrMax(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">HR rest (bpm)</Label>
                <Input type="number" value={hrRest} onChange={(e) => setHrRest(e.target.value)} />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Height (cm)</Label>
                <Input type="number" value={height} onChange={(e) => setHeight(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Training age (years)</Label>
                <Input type="number" value={trainingAge} onChange={(e) => setTrainingAge(e.target.value)} />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Primary event</Label>
                <Input value={primaryEvent} onChange={(e) => setPrimaryEvent(e.target.value)} placeholder="e.g. 1500m" />
              </div>
              <div>
                <Label className="text-xs">Typical training frequency (sessions/week)</Label>
                <Input type="number" value={frequency} onChange={(e) => setFrequency(e.target.value)} />
              </div>
            </div>

            <div>
              <Label className="text-xs">Secondary events (comma-separated)</Label>
              <Input
                value={secondaryEvents}
                onChange={(e) => setSecondaryEvents(e.target.value)}
                placeholder="e.g. 800m, 3000m steeplechase"
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Club</Label>
                <Input value={club} onChange={(e) => setClub(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ATHLETE_STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs">Time zone</Label>
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
                This is what determines FIT upload calendar dates and titles — separate from the account's own
                display time zone in Profile → Display preferences.
              </p>
            </div>

            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
