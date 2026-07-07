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
import { ExternalLink } from "lucide-react";
import { SingleImageUpload, MultiImageUpload } from "@/components/coach-profile/image-upload";
import { useAuthUser } from "@/lib/use-auth";

export const Route = createFileRoute("/_authenticated/app/coach/$slug")({
  component: CoachEditorPage,
});

function useCoachProfile(slug: string) {
  return useQuery({
    queryKey: ["coach-profile", slug],
    queryFn: async () => {
      const { data, error } = await supabase.from("coach_profiles").select("*").eq("slug", slug).maybeSingle();
      if (error) throw error;
      return data as any;
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
  const { data: coachData, isLoading, error } = useCoachProfile(slug);
  const coach: any = coachData;
  const { user } = useAuthUser();

  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (coach) {
      setForm({
        name: coach.name || "",
        team_name: coach.team_name || "",
        tagline: coach.tagline || "",
        bio: coach.bio || "",
        disciplines: toCsv(coach.disciplines),
        theme: coach.theme || "light",
        style: coach.style || "modern",
        nav: coach.nav || "top",
        brand_color: coach.brand_color || "#BD4130",
        hero_image_url: coach.hero_image_url || "",
        coach_photo_url: coach.coach_photo_url || "",
        logo_initials: coach.logo_initials || "",
        logo_url: coach.logo_url || "",
        certifications: toCsv(coach.certifications),
        gallery_images: (coach.gallery_images || []).join("\n"),
        location_city: coach.location?.city || "",
        location_venue: coach.location?.venue || "",
        location_remote: !!coach.location?.remoteAvailable,
        contact_email: coach.contact?.email || "",
        contact_phone: coach.contact?.phone || "",
        contact_instagram: coach.contact?.instagram || "",
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
    const { error } = await supabase
      .from("coach_profiles")
      .update({
        name: form.name,
        team_name: form.team_name || null,
        tagline: form.tagline,
        bio: form.bio,
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
      } as any)
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
              <input
                type="checkbox"
                checked={form.location_remote}
                onChange={(e) => setForm({ ...form, location_remote: e.target.checked })}
              />
              Remote/online coaching available
            </label>
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
          Stats, sample sessions, plans, and testimonials aren't editable here yet — happy to add structured editors for
          those next if useful.
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
