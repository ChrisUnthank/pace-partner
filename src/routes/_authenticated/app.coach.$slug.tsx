import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExternalLink, Plus, Trash2, IdCard } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { SingleImageUpload, MultiImageUpload } from "@/components/coach-profile/image-upload";
import { useAuthUser } from "@/lib/use-auth";
import { DEFAULT_SECTION_ORDER, SECTION_ORDER_LABELS, normalizeSectionOrder } from "@/components/coach-profile/coach-config";
import { Dot, SectionOrderList } from "@/components/profile-shared/section-order-list";
import { HeroImagePositionPicker } from "@/components/profile-shared/hero-image-position-picker";
import { galleryAspectClass } from "@/components/profile-shared/section-shell";
import { GalleryLayoutFields } from "@/components/profile-shared/gallery-layout-fields";

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

// Blog posts live in their own table (coach_blog_posts) rather than as a
// jsonb array on coach_profiles — unlike sample sessions/plans/testimonials,
// a post's `content` can grow arbitrarily long, and giving each post its own
// row/id keeps future features (a dedicated post URL, view counts, etc.)
// possible without a schema change later.
function useCoachBlogPosts(coachUserId: string | undefined) {
  return useQuery({
    queryKey: ["coach-blog-posts", coachUserId],
    enabled: !!coachUserId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("coach_blog_posts")
        .select("*")
        .eq("coach_user_id", coachUserId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// key -> label used both for the inline per-card toggle and as a fallback
// when merging with whatever's already saved. Stats has no key here since
// it has no editor card yet (flagged in the trailing note further down) —
// its toggle lives inline next to that note instead.
const SECTION_LABELS: Record<string, string> = {
  about: "About",
  sessions: "Sample sessions",
  athletes: "Athletes coached",
  gallery: "Gallery",
  blog: "Blog",
  plans: "Coaching plans",
  testimonials: "Testimonials",
  sponsors: "Sponsors",
};
const DEFAULT_SECTIONS: Record<string, boolean> = {
  stats: true,
  ...Object.fromEntries(Object.keys(SECTION_LABELS).map((k) => [k, true])),
};

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
  const { data: blogRows, refetch: refetchBlogPosts } = useCoachBlogPosts(user?.id);

  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [blogPosts, setBlogPosts] = useState<any[]>([]);
  const [savingBlogKey, setSavingBlogKey] = useState<string | null>(null);

  useEffect(() => {
    setBlogPosts(blogRows ?? []);
  }, [blogRows]);

  function sectionOn(key: string): boolean {
    return form.sections ? !!form.sections[key] : true;
  }
  function setSectionOn(key: string, v: boolean) {
    setForm({ ...form, sections: { ...(form.sections || DEFAULT_SECTIONS), [key]: v } });
  }
  function reorderSections(newOrder: string[]) {
    setForm({ ...form, section_order: newOrder });
  }

  async function toggleAthleteVisibility(coachAthleteId: string, next: boolean) {
    setTogglingId(coachAthleteId);
    const { error } = await (supabase.rpc as any)("toggle_coach_athlete_visibility", {
      p_coach_athlete_id: coachAthleteId,
      p_visible: next,
    });
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

  function updateTestimonial(i: number, patch: Partial<{ quote: string; author: string }>) {
    const next = [...(form.testimonials || [])];
    next[i] = { ...next[i], ...patch };
    setForm({ ...form, testimonials: next });
  }
  function addTestimonial() {
    setForm({ ...form, testimonials: [...(form.testimonials || []), { quote: "", author: "" }] });
  }
  function removeTestimonial(i: number) {
    setForm({ ...form, testimonials: form.testimonials.filter((_: any, idx: number) => idx !== i) });
  }

  function updateSponsor(i: number, patch: Partial<{ name: string; logo_url: string; website_url: string }>) {
    const next = [...(form.sponsors || [])];
    next[i] = { ...next[i], ...patch };
    setForm({ ...form, sponsors: next });
  }
  function addSponsor() {
    setForm({ ...form, sponsors: [...(form.sponsors || []), { name: "", logo_url: "", website_url: "" }] });
  }
  function removeSponsor(i: number) {
    setForm({ ...form, sponsors: form.sponsors.filter((_: any, idx: number) => idx !== i) });
  }

  function setGalleryImagePosition(url: string, x: number, y: number) {
    setForm({
      ...form,
      gallery_image_positions: { ...(form.gallery_image_positions || {}), [url]: { x, y } },
    });
  }

  function updateStat(i: number, patch: Partial<{ label: string; value: string }>) {
    const next = [...(form.stats || [])];
    next[i] = { ...next[i], ...patch };
    setForm({ ...form, stats: next });
  }
  function addStat() {
    setForm({ ...form, stats: [...(form.stats || []), { label: "", value: "" }] });
  }
  function removeStat(i: number) {
    setForm({ ...form, stats: form.stats.filter((_: any, idx: number) => idx !== i) });
  }

  // Blog posts save independently of the "Save changes" button above (each
  // post has its own Save/Publish button) — they live in their own table,
  // not in the coach_profiles row the rest of this form writes to.
  function updateBlogPost(i: number, patch: Partial<any>) {
    setBlogPosts((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function addBlogPost() {
    setBlogPosts((prev) => [
      {
        _localId: `new_${Date.now()}`,
        title: "",
        excerpt: "",
        content: "",
        cover_image_url: "",
        is_published: true,
      },
      ...prev,
    ]);
  }
  async function saveBlogPost(i: number) {
    const post = blogPosts[i];
    if (!user) return;
    const key = post.id ?? post._localId;
    setSavingBlogKey(key);
    const payload = {
      coach_user_id: user.id,
      title: post.title,
      excerpt: post.excerpt,
      content: post.content,
      cover_image_url: post.cover_image_url || null,
      is_published: post.is_published,
    };
    if (post.id) {
      const { error } = await (supabase as any).from("coach_blog_posts").update(payload).eq("id", post.id);
      if (error) {
        alert(error.message);
        setSavingBlogKey(null);
        return;
      }
    } else {
      const { data, error } = await (supabase as any).from("coach_blog_posts").insert(payload).select().single();
      if (error) {
        alert(error.message);
        setSavingBlogKey(null);
        return;
      }
      updateBlogPost(i, { id: data.id });
    }
    setSavingBlogKey(null);
    refetchBlogPosts();
  }
  async function deleteBlogPost(i: number) {
    const post = blogPosts[i];
    if (post.id) {
      const { error } = await (supabase as any).from("coach_blog_posts").delete().eq("id", post.id);
      if (error) {
        alert(error.message);
        return;
      }
    }
    setBlogPosts((prev) => prev.filter((_, idx) => idx !== i));
    refetchBlogPosts();
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
        secondary_color: c.secondary_color || "",
        hero_image_side: c.hero_image_side === "left" ? "left" : "right",
        section_density: c.section_density === "compact" ? "compact" : "comfortable",
        alternate_section_backgrounds: !!c.alternate_section_backgrounds,
        section_order: normalizeSectionOrder(c.section_order),
        hero_image_url: c.hero_image_url || "",
        hero_image_position_x: typeof c.hero_image_position_x === "number" ? c.hero_image_position_x : 50,
        hero_image_position_y: typeof c.hero_image_position_y === "number" ? c.hero_image_position_y : 50,
        gallery_columns: [2, 3, 4].includes(c.gallery_columns) ? c.gallery_columns : 3,
        gallery_aspect: ["square", "portrait", "landscape", "auto"].includes(c.gallery_aspect)
          ? c.gallery_aspect
          : "square",
        gallery_image_positions:
          c.gallery_image_positions && typeof c.gallery_image_positions === "object" ? c.gallery_image_positions : {},
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
        contact_strava: c.contact?.strava || "",
        contact_facebook: c.contact?.facebook || "",
        contact_twitter: c.contact?.twitter || "",
        contact_youtube: c.contact?.youtube || "",
        contact_tiktok: c.contact?.tiktok || "",
        contact_website: c.contact?.website || "",
        sample_sessions:
          Array.isArray(c.sample_sessions) && c.sample_sessions.length
            ? c.sample_sessions
            : [{ name: "", target: "", purpose: "" }],
        plans:
          Array.isArray(c.plans) && c.plans.length
            ? c.plans
            : [{ name: "", price: "", period: "mo", description: "", featured: false }],
        testimonials:
          Array.isArray(c.testimonials) && c.testimonials.length ? c.testimonials : [{ quote: "", author: "" }],
        sponsors: Array.isArray(c.sponsors) ? c.sponsors : [],
        stats: Array.isArray(c.stats) ? c.stats : [],
        is_published: !!c.is_published,
        sections: { ...DEFAULT_SECTIONS, ...(c.sections_enabled || {}) },
      });
    }
  }, [coach]);

  if (isLoading) {
    return (
      <AppShell fullWidth>
        <div className="text-sm text-muted-foreground">Loading coach profile…</div>
      </AppShell>
    );
  }

  if (error || !coach) {
    return (
      <AppShell fullWidth>
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
        secondary_color: form.secondary_color || null,
        hero_image_side: form.hero_image_side || "right",
        section_density: form.section_density || "comfortable",
        alternate_section_backgrounds: !!form.alternate_section_backgrounds,
        section_order: form.section_order || [...DEFAULT_SECTION_ORDER],
        hero_image_url: form.hero_image_url,
        hero_image_position_x: form.hero_image_position_x ?? 50,
        hero_image_position_y: form.hero_image_position_y ?? 50,
        gallery_columns: form.gallery_columns ?? 3,
        gallery_aspect: form.gallery_aspect ?? "square",
        gallery_image_positions: form.gallery_image_positions ?? {},
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
          strava: form.contact_strava || undefined,
          facebook: form.contact_facebook || undefined,
          twitter: form.contact_twitter || undefined,
          youtube: form.contact_youtube || undefined,
          tiktok: form.contact_tiktok || undefined,
          website: form.contact_website || undefined,
        },
        sample_sessions: (form.sample_sessions || []).filter((s: any) => s.name || s.target || s.purpose),
        plans: (form.plans || []).filter((p: any) => p.name || p.price || p.description),
        testimonials: (form.testimonials || []).filter((t: any) => t.quote || t.author),
        sponsors: (form.sponsors || []).filter((s: any) => s.name || s.logo_url || s.website_url),
        stats: (form.stats || []).filter((s: any) => s.label || s.value),
        is_published: !!form.is_published,
        sections_enabled: form.sections || DEFAULT_SECTIONS,
      })
      .eq("id", coach.id);
    setSaving(false);
    if (error) alert(error.message);
  }

  // Lightweight "have I filled this in" signal per tab — not a strict
  // validator, just enough to give a coach a sense of what's left before
  // publishing, shown as a dot next to each tab label.
  const profileDone = !!(form.name && form.tagline && form.bio);
  const contentDone = !!(
    (form.sample_sessions || []).some((s: any) => s.name) ||
    (form.plans || []).some((p: any) => p.name) ||
    (form.testimonials || []).some((t: any) => t.quote) ||
    blogPosts.some((p: any) => p.title) ||
    (form.sponsors || []).some((s: any) => s.name) ||
    (form.gallery_images || "").trim()
  );
  const athletesDone = (roster || []).some((r: any) => r.visible_on_coach_page);
  const contactDone = !!(form.location_city && form.contact_email);

  return (
    <AppShell fullWidth>
      <div className="space-y-6 pb-16">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
              style={{ background: "var(--accent-red)" }}
            >
              <IdCard className="h-5 w-5 text-white" strokeWidth={2} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Community</div>
              <h1 className="text-2xl font-bold leading-tight">Coach Page</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={!!form.is_published}
                onCheckedChange={(v) => setForm({ ...form, is_published: !!v })}
              />
              Published
            </label>
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
        <p className="-mt-4 text-sm text-muted-foreground">
          Build the public page athletes and prospects see at{" "}
          <span className="font-mono text-xs">app.co/c/{coach.slug}</span>. Work through the tabs below, use each
          section's "Show on page" switch to decide what appears, then check Published and save when you're ready to
          go live.
        </p>
        <p className="text-xs text-muted-foreground">
          {form.is_published
            ? "Your page is live at the link above."
            : "Your page is unpublished — visitors see a placeholder instead of your content."}
        </p>

        <Tabs defaultValue="profile" className="w-full">
          <TabsList className="flex h-auto flex-wrap gap-1">
            <TabsTrigger value="profile" className="gap-2">
              <Dot done={profileDone} />
              Profile
            </TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="content" className="gap-2">
              <Dot done={contentDone} />
              Content
            </TabsTrigger>
            <TabsTrigger value="athletes" className="gap-2">
              <Dot done={athletesDone} />
              Athletes
            </TabsTrigger>
            <TabsTrigger value="contact" className="gap-2">
              <Dot done={contactDone} />
              Location &amp; contact
            </TabsTrigger>
          </TabsList>

          {/* ---------------- Profile: identity + credentials ---------------- */}
          <TabsContent value="profile" className="mt-4 space-y-6">
            <p className="text-sm text-muted-foreground">
              Start here — this is your page's identity: who you are, what you coach, and the numbers that back it
              up. Everything on this tab feeds the Hero, Stats, and About sections at the top of your page.
            </p>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">Basics</CardTitle>
                  <CardDescription>
                    Your name, story, and credentials. Bio and achievements power the About section further down the
                    page.
                  </CardDescription>
                </div>
                <SectionToggle checked={sectionOn("about")} onCheckedChange={(v) => setSectionOn("about", v)} />
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
                <Field label="Tagline" hint="Shown directly under your name in the hero — keep it to one line.">
                  <Input value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} />
                </Field>
                <Field label="Bio" hint="Your main introduction — a few sentences on your background and approach.">
                  <Textarea rows={5} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
                </Field>
                <Field
                  label="Coaching philosophy (optional, shown as its own block)"
                  hint="Goes deeper than the bio — how you actually structure training week to week."
                >
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
                <Field label="Disciplines (comma separated)" hint="Shown as tags under your tagline in the hero.">
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
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">Stats</CardTitle>
                  <CardDescription>
                    The number strip under your hero (years coaching, athletes coached, PBs, whatever's most
                    credible). Usually 3–4 entries reads best.
                  </CardDescription>
                </div>
                <SectionToggle checked={sectionOn("stats")} onCheckedChange={(v) => setSectionOn("stats", v)} />
              </CardHeader>
              <CardContent className="space-y-4">
                {(form.stats || []).map((s: any, i: number) => (
                  <div key={i} className="flex items-end gap-2 rounded-md border p-3">
                    <Field label="Value" hint={i === 0 ? "e.g. 11, 38, 2:19:04" : undefined} >
                      <Input
                        value={s.value}
                        onChange={(e) => updateStat(i, { value: e.target.value })}
                        placeholder="11"
                      />
                    </Field>
                    <Field label="Label" hint={i === 0 ? "e.g. Years coaching" : undefined}>
                      <Input
                        value={s.label}
                        onChange={(e) => updateStat(i, { label: e.target.value })}
                        placeholder="Years coaching"
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeStat(i)}
                      className="h-9 px-2 text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addStat}>
                  <Plus className="mr-2 h-3.5 w-3.5" /> Add stat
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Appearance: look, feel, and layout ---------------- */}
          <TabsContent value="appearance" className="mt-4 space-y-6">
            <p className="text-sm text-muted-foreground">
              Pick a look and feel. Theme and style apply to every section at once — try a couple of combinations in
              Preview before settling.
            </p>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Theme &amp; branding</CardTitle>
                <CardDescription>
                  Secondary color is optional — when set, it's used for the "View plans" button and to alternate the
                  Stats numbers, giving the page a two-tone identity instead of a single flat color everywhere.
                </CardDescription>
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
                <Field label="Secondary color (optional)" hint="Leave blank to keep everything single-color.">
                  <div className="flex items-center gap-2">
                    <Input
                      type="color"
                      value={form.secondary_color || "#2E5266"}
                      onChange={(e) => setForm({ ...form, secondary_color: e.target.value })}
                      className="h-10 w-20 p-1"
                    />
                    {form.secondary_color && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ ...form, secondary_color: "" })}>
                        Clear
                      </Button>
                    )}
                  </div>
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
                  <Field label="Hero image" hint="The large banner image behind your name at the top of the page.">
                    <SingleImageUpload
                      userId={user.id}
                      value={form.hero_image_url}
                      onChange={(url) => setForm({ ...form, hero_image_url: url })}
                      label="hero image"
                    />
                  </Field>
                )}
                {user && form.hero_image_url && (
                  <Field label="Hero image position" hint="Controls what stays visible when the image gets cropped at different screen sizes.">
                    <HeroImagePositionPicker
                      imageUrl={form.hero_image_url}
                      x={form.hero_image_position_x ?? 50}
                      y={form.hero_image_position_y ?? 50}
                      onChange={(x, y) => setForm({ ...form, hero_image_position_x: x, hero_image_position_y: y })}
                    />
                  </Field>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Layout</CardTitle>
                <CardDescription>
                  Two independent knobs for fine-tuning the page without touching theme or style.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Hero image side"
                  hint="Only affects the Modern style — Traditional always stacks the image above, centered."
                >
                  <Select
                    value={form.hero_image_side || "right"}
                    onValueChange={(v) => setForm({ ...form, hero_image_side: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="right">Image on the right</SelectItem>
                      <SelectItem value="left">Image on the left</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Section spacing" hint="Compact suits a page with lots of sections turned on.">
                  <Select
                    value={form.section_density || "comfortable"}
                    onValueChange={(v) => setForm({ ...form, section_density: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="comfortable">Comfortable</SelectItem>
                      <SelectItem value="compact">Compact</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2">
                  <div>
                    <div className="text-sm font-medium">Alternate section backgrounds</div>
                    <p className="text-xs text-muted-foreground">
                      Every other section gets a subtle grey tint (light grey on the Light theme, darker grey on
                      Dark) to separate sections visually without adding borders.
                    </p>
                  </div>
                  <Switch
                    checked={!!form.alternate_section_backgrounds}
                    onCheckedChange={(v) => setForm({ ...form, alternate_section_backgrounds: v })}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Section order</CardTitle>
                <CardDescription>
                  Drag to change the order sections appear in on your page. Home always comes first; this only
                  reorders what comes after it. The dot shows whether a section is currently switched on — toggle it
                  from its own card in the Profile/Content/Athletes tabs, not from here.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SectionOrderList
                  order={form.section_order || [...DEFAULT_SECTION_ORDER]}
                  labels={SECTION_ORDER_LABELS}
                  isOn={(key) => (key === "contact" ? true : sectionOn(key))}
                  onReorder={reorderSections}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Content: everything that fills out the page body ---------------- */}
          <TabsContent value="content" className="mt-4 space-y-6">
            <p className="text-sm text-muted-foreground">
              Show visitors what working with you looks like. None of these are required — add whichever apply to
              your coaching, and use "Show on page" to hide anything you'd rather keep off for now without losing
              what you've written.
            </p>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">Sample sessions</CardTitle>
                  <CardDescription>
                    A few example workouts that give visitors a feel for your coaching style.
                  </CardDescription>
                </div>
                <SectionToggle checked={sectionOn("sessions")} onCheckedChange={(v) => setSectionOn("sessions", v)} />
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
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">Coaching plans</CardTitle>
                  <CardDescription>Your pricing tiers. Mark one "featured" to highlight it as most popular.</CardDescription>
                </div>
                <SectionToggle checked={sectionOn("plans")} onCheckedChange={(v) => setSectionOn("plans", v)} />
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
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">Testimonials</CardTitle>
                  <CardDescription>
                    Social proof from athletes you've coached — often what actually turns a browser into an inquiry.
                  </CardDescription>
                </div>
                <SectionToggle
                  checked={sectionOn("testimonials")}
                  onCheckedChange={(v) => setSectionOn("testimonials", v)}
                />
              </CardHeader>
              <CardContent className="space-y-4">
                {(form.testimonials || []).map((t: any, i: number) => (
                  <div key={i} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Testimonial {i + 1}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeTestimonial(i)}
                        className="h-7 px-2 text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <Field label="Quote">
                      <Textarea
                        rows={3}
                        value={t.quote}
                        onChange={(e) => updateTestimonial(i, { quote: e.target.value })}
                        placeholder="The interval sessions actually match what I run on race day now."
                      />
                    </Field>
                    <Field label="Author">
                      <Input
                        value={t.author}
                        onChange={(e) => updateTestimonial(i, { author: e.target.value })}
                        placeholder="Sarah K. — 2:58 marathon debut"
                      />
                    </Field>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addTestimonial}>
                  <Plus className="mr-2 h-3.5 w-3.5" /> Add testimonial
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">Blog</CardTitle>
                  <CardDescription>
                    Training philosophy, race reports, or FAQs. Each post opens in a reader view when a visitor clicks
                    it — no separate page to manage.
                  </CardDescription>
                </div>
                <SectionToggle checked={sectionOn("blog")} onCheckedChange={(v) => setSectionOn("blog", v)} />
              </CardHeader>
              <CardContent className="space-y-4">
                {blogPosts.map((p: any, i: number) => {
                  const key = p.id ?? p._localId;
                  return (
                    <div key={key} className="space-y-2 rounded-md border p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">{p.id ? "Post" : "New post (unsaved)"}</span>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-1.5 text-xs">
                            <Checkbox
                              checked={!!p.is_published}
                              onCheckedChange={(v) => updateBlogPost(i, { is_published: !!v })}
                            />
                            Published
                          </label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteBlogPost(i)}
                            className="h-7 px-2 text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <Field label="Title">
                        <Input
                          value={p.title}
                          onChange={(e) => updateBlogPost(i, { title: e.target.value })}
                          placeholder="How I build a marathon block"
                        />
                      </Field>
                      <Field label="Excerpt (short teaser shown on the card)">
                        <Textarea
                          rows={2}
                          value={p.excerpt}
                          onChange={(e) => updateBlogPost(i, { excerpt: e.target.value })}
                        />
                      </Field>
                      <Field label="Full content">
                        <Textarea
                          rows={6}
                          value={p.content}
                          onChange={(e) => updateBlogPost(i, { content: e.target.value })}
                        />
                      </Field>
                      {user && (
                        <Field label="Cover image (optional)">
                          <SingleImageUpload
                            userId={user.id}
                            value={p.cover_image_url}
                            onChange={(url) => updateBlogPost(i, { cover_image_url: url })}
                            label="cover image"
                          />
                        </Field>
                      )}
                      <Button type="button" size="sm" onClick={() => saveBlogPost(i)} disabled={savingBlogKey === key}>
                        {savingBlogKey === key ? "Saving…" : p.id ? "Save post" : "Publish post"}
                      </Button>
                    </div>
                  );
                })}
                <Button type="button" variant="outline" size="sm" onClick={addBlogPost}>
                  <Plus className="mr-2 h-3.5 w-3.5" /> Add blog post
                </Button>
                <p className="text-xs text-muted-foreground">
                  Blog posts save on their own — each post has its own Save/Publish button above, separate from the
                  "Save changes" button at the top of the page.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">Sponsors</CardTitle>
                  <CardDescription>
                    Shown as a "Proudly supported by" strip near the bottom of your page.
                  </CardDescription>
                </div>
                <SectionToggle checked={sectionOn("sponsors")} onCheckedChange={(v) => setSectionOn("sponsors", v)} />
              </CardHeader>
              <CardContent className="space-y-4">
                {(form.sponsors || []).map((s: any, i: number) => (
                  <div key={i} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Sponsor {i + 1}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeSponsor(i)}
                        className="h-7 px-2 text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <Field label="Name">
                      <Input
                        value={s.name}
                        onChange={(e) => updateSponsor(i, { name: e.target.value })}
                        placeholder="Acme Running Co."
                      />
                    </Field>
                    <Field label="Website URL">
                      <Input
                        value={s.website_url}
                        onChange={(e) => updateSponsor(i, { website_url: e.target.value })}
                        placeholder="https://acmerunning.com"
                      />
                    </Field>
                    {user && (
                      <Field label="Logo">
                        <SingleImageUpload
                          userId={user.id}
                          value={s.logo_url}
                          onChange={(url) => updateSponsor(i, { logo_url: url })}
                          label="sponsor logo"
                          aspect="aspect-square"
                        />
                      </Field>
                    )}
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addSponsor}>
                  <Plus className="mr-2 h-3.5 w-3.5" /> Add sponsor
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">Gallery</CardTitle>
                  <CardDescription>Photos of training, races, or your squad, shown in a clickable grid.</CardDescription>
                </div>
                <SectionToggle checked={sectionOn("gallery")} onCheckedChange={(v) => setSectionOn("gallery", v)} />
              </CardHeader>
              <CardContent className="space-y-4">
                {user && (
                  <MultiImageUpload
                    userId={user.id}
                    values={form.gallery_images ? form.gallery_images.split("\n").filter(Boolean) : []}
                    onChange={(urls) => setForm({ ...form, gallery_images: urls.join("\n") })}
                  />
                )}
                <GalleryLayoutFields
                  columns={form.gallery_columns ?? 3}
                  aspect={form.gallery_aspect ?? "square"}
                  onColumnsChange={(v) => setForm({ ...form, gallery_columns: v })}
                  onAspectChange={(v) => setForm({ ...form, gallery_aspect: v })}
                />
                {form.gallery_aspect !== "auto" &&
                  (form.gallery_images ? form.gallery_images.split("\n").filter(Boolean) : []).length > 0 && (
                    <div className="space-y-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        Reposition individual photos (only matters for Square/Portrait/Landscape — skipped for "no
                        crop")
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {(form.gallery_images ? form.gallery_images.split("\n").filter(Boolean) : []).map(
                          (url: string, i: number) => {
                            const pos = (form.gallery_image_positions || {})[url] ?? { x: 50, y: 50 };
                            return (
                              <div key={url + i} className="rounded-md border p-3">
                                <p className="mb-2 text-xs text-muted-foreground">Photo {i + 1}</p>
                                <HeroImagePositionPicker
                                  imageUrl={url}
                                  x={pos.x}
                                  y={pos.y}
                                  onChange={(x, y) => setGalleryImagePosition(url, x, y)}
                                  aspectClassName={galleryAspectClass(form.gallery_aspect ?? "square")}
                                />
                              </div>
                            );
                          },
                        )}
                      </div>
                    </div>
                  )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Athletes ---------------- */}
          <TabsContent value="athletes" className="mt-4 space-y-6">
            <p className="text-sm text-muted-foreground">
              Showcase athletes you coach. Nothing is shown by default — check the box next to anyone you'd like
              visible on your public page.
            </p>
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">Athletes shown on this page</CardTitle>
                  <CardDescription>Toggling an athlete below saves immediately — no need to hit Save changes.</CardDescription>
                </div>
                <SectionToggle checked={sectionOn("athletes")} onCheckedChange={(v) => setSectionOn("athletes", v)} />
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
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Location & contact ---------------- */}
          <TabsContent value="contact" className="mt-4 space-y-6">
            <p className="text-sm text-muted-foreground">
              Where and how people reach you. This section is always shown on your page, so it's worth double-checking
              before you publish.
            </p>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Location</CardTitle>
                <CardDescription>Powers the map and the "in-person vs remote" badge on your page.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field label="City">
                  <Input
                    value={form.location_city}
                    onChange={(e) => setForm({ ...form, location_city: e.target.value })}
                  />
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
                <CardTitle className="text-base">Contact</CardTitle>
                <CardDescription>Feeds the inquiry form and the footer links visitors use to reach you.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field label="Email">
                  <Input
                    value={form.contact_email}
                    onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                  />
                </Field>
                <Field label="Phone (optional)">
                  <Input
                    value={form.contact_phone}
                    onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
                  />
                </Field>
                <Field label="Instagram handle">
                  <Input
                    value={form.contact_instagram}
                    onChange={(e) => setForm({ ...form, contact_instagram: e.target.value })}
                    placeholder="@yourcoachname"
                  />
                </Field>
                <Field label="Facebook page URL">
                  <Input
                    value={form.contact_facebook}
                    onChange={(e) => setForm({ ...form, contact_facebook: e.target.value })}
                    placeholder="https://facebook.com/..."
                  />
                </Field>
                <Field label="X (Twitter) handle">
                  <Input
                    value={form.contact_twitter}
                    onChange={(e) => setForm({ ...form, contact_twitter: e.target.value })}
                    placeholder="@yourcoachname"
                  />
                </Field>
                <Field label="YouTube channel URL">
                  <Input
                    value={form.contact_youtube}
                    onChange={(e) => setForm({ ...form, contact_youtube: e.target.value })}
                    placeholder="https://youtube.com/@..."
                  />
                </Field>
                <Field label="TikTok handle">
                  <Input
                    value={form.contact_tiktok}
                    onChange={(e) => setForm({ ...form, contact_tiktok: e.target.value })}
                    placeholder="@yourcoachname"
                  />
                </Field>
                <Field label="Strava profile URL">
                  <Input
                    value={form.contact_strava}
                    onChange={(e) => setForm({ ...form, contact_strava: e.target.value })}
                    placeholder="https://strava.com/athletes/..."
                  />
                </Field>
                <Field label="Website URL">
                  <Input
                    value={form.contact_website}
                    onChange={(e) => setForm({ ...form, contact_website: e.target.value })}
                    placeholder="https://..."
                  />
                </Field>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function SectionToggle({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
      Show on page
    </label>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
