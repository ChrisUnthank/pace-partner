import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { SingleImageUpload, MultiImageUpload } from "@/components/coach-profile/image-upload";
import { useAuthUser } from "@/lib/use-auth";

export const Route = createFileRoute("/_authenticated/app/coach/$slug")({
  component: CoachEditorPage,
});

function useCoachProfile(slug: string) {
  return useQuery({
    queryKey: ["coach-profile", slug],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("coach_profiles").select("*").eq("slug", slug).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

function useCoachedAthletes(coachUserId: string | undefined) {
  return useQuery({
    queryKey: ["coach-athletes-roster", coachUserId],
    enabled: !!coachUserId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("coach_athletes")
        .select("id, athlete_id, visible_on_coach_page, athletes ( id, name, primary_event, profile_image_url )")
        .eq("coach_user_id", coachUserId);
      if (error) throw error;
      return data ?? [];
    },
  });
}

// Comma-separated helpers for simple array fields
function toCsv(v: unknown) {
  return Array.isArray(v) ? v.join(", ") : "";
}
function fromCsv(v: string) {
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function CoachEditorPage() {
  const { slug } = useParams({ from: "/_authenticated/app/coach/$slug" });
  const { data: coach, isLoading, error } = useCoachProfile(slug);
  const { user } = useAuthUser();
  const { data: roster, refetch: refetchRoster } = useCoachedAthletes(user?.id);

  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function toggleAthleteVisibility(coachAthleteId: string, next: boolean) {
    setTogglingId(coachAthleteId);
    const { error } = await (supabase as any)
      .from("coach_athletes")
      .update({ visible_on_coach_page: next })
      .eq("id", coachAthleteId);
    setTogglingId(null);
    if (error) {
      alert(error.message);
      return;
    }
    refetchRoster();
  }

  function updateSession(i: number, patch: Partial<{ name: string; target: string; purpose: string }>) {
    const next = [...(form.sample_sessions || [])];
    next[i] = { ...next[i], ...patch };
    setForm({ ...form, sample_sessions: next });
  }
  function addSession() {
    setForm({
      ...form,
      sample_sessions: [...(form.sample_sessions || []), { name: "", target: "", purpose: "" }],
    });
  }
  function removeSession(i: number) {
    setForm({ ...form, sample_sessions: form.sample_sessions.filter((_: any, idx: number) => idx !== i) });
  }

  function updatePlan(
    i: number,
    patch: Partial<{ name: string; price: string; period: string; description: string; featured: boolean }>,
  ) {
    const next = [...(form.plans || [])];
    next[i] = { ...next[i], ...patch };
    setForm({ ...form, plans: next });
  }
  function addPlan() {
    setForm({
      ...form,
      plans: [...(form.plans || []), { name: "", price: "", period: "mo", description: "", featured: false }],
    });
  }
  function removePlan(i: number) {
    setForm({ ...form, plans: form.plans.filter((_: any, idx: number) => idx !== i) });
  }

  useEffect(() => {
    if (coach) {
      const c: any = coach;
      setForm({
        name: c.name || "",
        team_name: c.team_name || "",
        tagline: c.tagline || "",
        bio: c.bio || "",
        coaching_philosophy: c.coaching_philosophy || "",
        achievements: (c.achievements || []).join("\n"),
        disciplines: toCsv(c.disciplines),
        theme: c.theme || "light",
        style: c.style || "modern",
        nav: c.nav || "top",
        brand_color: c.brand_color || "#BD4130",
        hero_image_url: c.hero_image_url || "",
        coach_photo_url: c.coach_photo_url || "",
        logo_initials: c.logo_initials || "",
        logo_url: c.logo_url || "",
        certifications: toCsv(c.certifications),
        gallery_images: (c.gallery_images || []).join("\n"),
        location_city: c.location?.city || "",
        location_venue: c.location?.venue || "",
        location_remote: !!c.location?.remoteAvailable,
        contact_email: c.contact?.email || "",
        contact_phone: c.contact?.phone || "",
        contact_instagram: c.contact?.instagram || "",
        sample_sessions:
          Array.isArray(c.sample_sessions) && c.sample_sessions.length
            ? c.sample_sessions
            : [{ name: "", target: "", purpose: "" }],
        plans:
          Array.isArray(c.plans) && c.plans.length
            ? c.plans
            : [{ name: "", price: "", period: "mo", description: "", featured: false }],
      });
    }
  }, [coach]);

  if (isLoading) {
    return (
      <AppShell>
        <div className="text-sm text-muted-foreground">Loading coach profile…</div>
      </AppShell>
    );
  }

  if (error || !coach) {
    return (
      <AppShell>
        <div className="text-sm text-muted-foreground">Coach not found.</div>
      </AppShell>
    );
  }

  async function handleSave() {
    setSaving(true);
    const { error } = await (supabase as any)
      .from("coach_profiles")
      .update({
        name: form.name,
        team_name: form.team_name || null,
        tagline: form.tagline,
        bio: form.bio,
        coaching_philosophy: form.coaching_philosophy || null,
        achievements: form.achievements
          .split("\n")
          .map((s: string) => s.trim())
          .filter(Boolean),
        disciplines: fromCsv(form.disciplines),
        theme: form.theme,
        style: form.style,
        nav: form.nav,
        brand_color: form.brand_color,
        hero_image_url: form.hero_image_url,
        coach_photo_url: form.coach_photo_url || null,
        logo_initials: form.logo_initials,
        logo_url: form.logo_url || null,
        certifications: fromCsv(form.certifications),
        gallery_images: form.gallery_images
          .split("\n")
          .map((s: string) => s.trim())
          .filter(Boolean),
        location: {
          city: form.location_city,
          venue: form.location_venue || undefined,
          remoteAvailable: form.location_remote,
        },
        contact: {
          email: form.contact_email || undefined,
          phone: form.contact_phone || undefined,
          instagram: form.contact_instagram || undefined,
        },
        sample_sessions: (form.sample_sessions || []).filter((s: any) => s.name || s.target || s.purpose),
        plans: (form.plans || []).filter((p: any) => p.name || p.price || p.description),
      })
      .eq("id", coach.id);
    setSaving(false);
    if (error) alert(error.message);
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-6 pb-16">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Coach Page</h1>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <a href={`/c/${coach.slug}`} target="_blank" rel="noreferrer">
                Preview <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Basics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Team / squad name (optional)">
              <Input
                value={form.team_name}
                onChange={(e) => setForm({ ...form, team_name: e.target.value })}
                placeholder="redLINE Running"
              />
            </Field>
            <Field label="Tagline">
              <Input value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} />
            </Field>
            <Field label="Bio">
              <Textarea rows={5} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
            </Field>
            <Field label="Coaching philosophy (optional, shown as its own block)">
              <Textarea
                rows={4}
                value={form.coaching_philosophy}
                onChange={(e) => setForm({ ...form, coaching_philosophy: e.target.value })}
                placeholder="How you approach training..."
              />
            </Field>
            <Field label="Achievements (one per line)">
              <Textarea
                rows={3}
                value={form.achievements}
                onChange={(e) => setForm({ ...form, achievements: e.target.value })}
                placeholder={"2x Olympian, 3000m Steeplechase\n14 Boston Marathon qualifiers coached"}
              />
            </Field>
            <Field label="Disciplines (comma separated)">
              <Input
                value={form.disciplines}
                onChange={(e) => setForm({ ...form, disciplines: e.target.value })}
                placeholder="Track & Interval, Marathon, 5K/10K"
              />
            </Field>
            <Field label="Certifications (comma separated)">
              <Input
                value={form.certifications}
                onChange={(e) => setForm({ ...form, certifications: e.target.value })}
                placeholder="USATF Level 2, USOPC SafeSport"
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Appearance</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Field label="Theme">
              <Select value={form.theme} onValueChange={(v) => setForm({ ...form, theme: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Style">
              <Select value={form.style} onValueChange={(v) => setForm({ ...form, style: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="modern">Modern</SelectItem>
                  <SelectItem value="traditional">Traditional</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Nav">
              <Select value={form.nav} onValueChange={(v) => setForm({ ...form, nav: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="top">Top bar</SelectItem>
                  <SelectItem value="sidebar">Sidebar</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Brand color">
              <Input
                type="color"
                value={form.brand_color}
                onChange={(e) => setForm({ ...form, brand_color: e.target.value })}
                className="h-10 w-20 p-1"
              />
            </Field>
            <Field label="Logo initials (used if no team logo is uploaded)">
              <Input
                value={form.logo_initials}
                onChange={(e) => setForm({ ...form, logo_initials: e.target.value })}
                maxLength={3}
              />
            </Field>
            {user && (
              <Field label="Team / squad logo (optional)">
                <SingleImageUpload
                  userId={user.id}
                  value={form.logo_url}
                  onChange={(url) => setForm({ ...form, logo_url: url })}
                  label="team logo"
                  aspect="aspect-square"
                />
              </Field>
            )}
            {user && (
              <Field label="Coach profile picture">
                <SingleImageUpload
                  userId={user.id}
                  value={form.coach_photo_url}
                  onChange={(url) => setForm({ ...form, coach_photo_url: url })}
                  label="profile picture"
                  aspect="aspect-square"
                />
              </Field>
            )}
            {user && (
              <Field label="Hero image">
                <SingleImageUpload
                  userId={user.id}
                  value={form.hero_image_url}
                  onChange={(url) => setForm({ ...form, hero_image_url: url })}
                  label="hero image"
                />
              </Field>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gallery</CardTitle>
          </CardHeader>
          <CardContent>
            {user && (
              <MultiImageUpload
                userId={user.id}
                values={form.gallery_images ? form.gallery_images.split("\n").filter(Boolean) : []}
                onChange={(urls) => setForm({ ...form, gallery_images: urls.join("\n") })}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sample sessions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(form.sample_sessions || []).map((s: any, i: number) => (
              <div key={i} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Session {i + 1}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeSession(i)}
                    className="h-7 px-2 text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Field label="Name">
                  <Input
                    value={s.name}
                    onChange={(e) => updateSession(i, { name: e.target.value })}
                    placeholder="8 × 400m"
                  />
                </Field>
                <Field label="Target / pace">
                  <Input
                    value={s.target}
                    onChange={(e) => updateSession(i, { target: e.target.value })}
                    placeholder="5K pace, 90s jog recovery"
                  />
                </Field>
                <Field label="Purpose">
                  <Input
                    value={s.purpose}
                    onChange={(e) => updateSession(i, { purpose: e.target.value })}
                    placeholder="Speed and turnover"
                  />
                </Field>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addSession}>
              <Plus className="mr-2 h-3.5 w-3.5" /> Add session
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Coaching plans</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(form.plans || []).map((p: any, i: number) => (
              <div key={i} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Plan {i + 1}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removePlan(i)}
                    className="h-7 px-2 text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Field label="Name">
                  <Input
                    value={p.name}
                    onChange={(e) => updatePlan(i, { name: e.target.value })}
                    placeholder="Guided"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Price">
                    <Input
                      value={p.price}
                      onChange={(e) => updatePlan(i, { price: e.target.value })}
                      placeholder="179"
                    />
                  </Field>
                  <Field label="Period">
                    <Input
                      value={p.period}
                      onChange={(e) => updatePlan(i, { period: e.target.value })}
                      placeholder="mo"
                    />
                  </Field>
                </div>
                <Field label="Description">
                  <Input
                    value={p.description}
                    onChange={(e) => updatePlan(i, { description: e.target.value })}
                    placeholder="Weekly adjustments + race tactics"
                  />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={!!p.featured} onCheckedChange={(v) => updatePlan(i, { featured: !!v })} />
                  Highlight this plan (most popular)
                </label>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addPlan}>
              <Plus className="mr-2 h-3.5 w-3.5" /> Add plan
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Location</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="City">
              <Input value={form.location_city} onChange={(e) => setForm({ ...form, location_city: e.target.value })} />
            </Field>
            <Field label="Venue (optional)">
              <Input
                value={form.location_venue}
                onChange={(e) => setForm({ ...form, location_venue: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox
                checked={form.location_remote}
                onCheckedChange={(v) => setForm({ ...form, location_remote: !!v })}
              />
              Remote/online coaching available
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Athletes shown on this page</CardTitle>
          </CardHeader>
          <CardContent>
            {!roster || roster.length === 0 ? (
              <p className="text-sm text-muted-foreground">No athletes linked to your roster yet.</p>
            ) : (
              <div className="space-y-2">
                {roster.map((row: any) => {
                  const athlete = row.athletes;
                  if (!athlete) return null;
                  return (
                    <label key={row.id} className="flex items-center gap-3 rounded-md border p-3 text-sm">
                      <Checkbox
                        checked={row.visible_on_coach_page}
                        disabled={togglingId === row.id}
                        onCheckedChange={(v) => toggleAthleteVisibility(row.id, !!v)}
                      />
                      {athlete.profile_image_url ? (
                        <img
                          src={athlete.profile_image_url}
                          alt={athlete.name}
                          className="h-8 w-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs">
                          {athlete.name?.[0]?.toUpperCase() ?? "?"}
                        </div>
                      )}
                      <span className="flex-1">{athlete.name}</span>
                      {athlete.primary_event && (
                        <span className="text-xs text-muted-foreground">{athlete.primary_event}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Check the athletes you'd like visible on your public coach page. Toggling saves immediately.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Email">
              <Input value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
            </Field>
            <Field label="Phone (optional)">
              <Input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
            </Field>
            <Field label="Instagram handle">
              <Input
                value={form.contact_instagram}
                onChange={(e) => setForm({ ...form, contact_instagram: e.target.value })}
                placeholder="@yourcoachname"
              />
            </Field>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Stats and testimonials aren't editable here yet — happy to add structured editors for those next if useful.
        </p>
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
