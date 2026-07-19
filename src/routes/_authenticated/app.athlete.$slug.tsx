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
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { SingleImageUpload, MultiImageUpload } from "@/components/coach-profile/image-upload";
import { useAuthUser } from "@/lib/use-auth";
import {
  DEFAULT_SECTION_ORDER,
  SECTION_ORDER_LABELS,
  normalizeSectionOrder,
} from "@/components/athlete-profile/athlete-config";
import { Dot, SectionOrderList } from "@/components/profile-shared/section-order-list";
import { HeroImagePositionPicker } from "@/components/profile-shared/hero-image-position-picker";

export const Route = createFileRoute("/_authenticated/app/athlete/$slug")({
  component: AthleteEditorPage,
});

function useAthleteProfile(slug: string) {
  return useQuery({
    queryKey: ["athlete-profile-editor", slug],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("athlete_profiles")
        .select("*, athletes ( id, name, primary_event, profile_image_url, user_id )")
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

// Every race-context performance for this athlete, public or not — the
// editor needs to show both so the athlete can see what's currently
// hidden, not just what's already public.
function useRaceResults(athleteId: string | undefined) {
  return useQuery({
    queryKey: ["athlete-profile-editor-results", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("performances")
        .select("id, distance_m, time_seconds, event_name, performance_date, overall_place, is_public")
        .eq("athlete_id", athleteId)
        .eq("context", "race")
        .order("performance_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useSquadMates(athleteId: string | undefined) {
  return useQuery({
    queryKey: ["athlete-profile-editor-squadmates", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data: myCoaches, error: e1 } = await (supabase as any)
        .from("coach_athletes")
        .select("coach_user_id")
        .eq("athlete_id", athleteId);
      if (e1) throw e1;
      const coachIds = [...new Set((myCoaches ?? []).map((r: any) => r.coach_user_id))];
      if (!coachIds.length) return [];
      const { data: teammates, error: e2 } = await (supabase as any)
        .from("coach_athletes")
        .select("athlete_id, athletes ( id, name, primary_event, profile_image_url )")
        .in("coach_user_id", coachIds);
      if (e2) throw e2;
      const seen = new Set<string>();
      const out: { id: string; name: string; event?: string; photoUrl?: string }[] = [];
      for (const row of teammates ?? []) {
        const a = row.athletes;
        if (!a || a.id === athleteId || seen.has(a.id)) continue;
        seen.add(a.id);
        out.push({ id: a.id, name: a.name, event: a.primary_event ?? undefined, photoUrl: a.profile_image_url ?? undefined });
      }
      return out;
    },
  });
}

function useAthleteGoal(athleteId: string | undefined) {
  return useQuery({
    queryKey: ["athlete-profile-editor-goal", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("athlete_goals")
        .select("title, race_date")
        .eq("athlete_id", athleteId)
        .eq("is_primary", true)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

function useAthleteBlogPosts(athleteId: string | undefined) {
  return useQuery({
    queryKey: ["athlete-blog-posts", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("athlete_blog_posts")
        .select("*")
        .eq("athlete_id", athleteId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function AthleteEditorPage() {
  const { slug } = useParams({ from: "/_authenticated/app/athlete/$slug" });
  const { data: profile, isLoading, error, refetch: refetchProfile } = useAthleteProfile(slug);
  const { user } = useAuthUser();
  const athlete = profile?.athletes;

  const { data: results, refetch: refetchResults } = useRaceResults(athlete?.id);
  const { data: squadMates } = useSquadMates(athlete?.id);
  const { data: goal } = useAthleteGoal(athlete?.id);
  const { data: blogRows, refetch: refetchBlogPosts } = useAthleteBlogPosts(athlete?.id);

  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [togglingResultId, setTogglingResultId] = useState<string | null>(null);
  const [blogPosts, setBlogPosts] = useState<any[]>([]);
  const [savingBlogKey, setSavingBlogKey] = useState<string | null>(null);

  useEffect(() => {
    setBlogPosts(blogRows ?? []);
  }, [blogRows]);

  useEffect(() => {
    if (profile) {
      const p: any = profile;
      setForm({
        tagline: p.tagline || "",
        bio: p.bio || "",
        achievements: (p.achievements || []).join("\n"),
        disciplines: (p.disciplines || []).join(", "),
        theme: p.theme || "light",
        style: p.style || "modern",
        nav: p.nav || "top",
        brand_color: p.brand_color || "#2E5266",
        secondary_color: p.secondary_color || "",
        hero_image_side: p.hero_image_side === "left" ? "left" : "right",
        section_density: p.section_density === "compact" ? "compact" : "comfortable",
        alternate_section_backgrounds: !!p.alternate_section_backgrounds,
        hero_image_url: p.hero_image_url || "",
        hero_image_position_x: typeof p.hero_image_position_x === "number" ? p.hero_image_position_x : 50,
        hero_image_position_y: typeof p.hero_image_position_y === "number" ? p.hero_image_position_y : 50,
        gallery_images: (p.gallery_images || []).join("\n"),
        stats: Array.isArray(p.stats) && p.stats.length ? p.stats : [],
        sponsors: Array.isArray(p.sponsors) ? p.sponsors : [],
        donate_label: p.donate_label || "",
        donate_url: p.donate_url || "",
        training_partners_added: Array.isArray(p.training_partners_added) ? p.training_partners_added : [],
        training_partners_hidden_ids: Array.isArray(p.training_partners_hidden_ids)
          ? p.training_partners_hidden_ids
          : [],
        contact_email: p.contact?.email || "",
        contact_instagram: p.contact?.instagram || "",
        contact_strava: p.contact?.strava || "",
        is_published: !!p.is_published,
        sections: { ...Object.fromEntries(DEFAULT_SECTION_ORDER.map((k) => [k, true])), ...(p.sections_enabled || {}) },
        section_order: normalizeSectionOrder(p.section_order),
      });
    }
  }, [profile]);

  function sectionOn(key: string): boolean {
    return form.sections ? !!form.sections[key] : true;
  }
  function setSectionOn(key: string, v: boolean) {
    setForm({ ...form, sections: { ...form.sections, [key]: v } });
  }
  function reorderSections(newOrder: string[]) {
    setForm({ ...form, section_order: newOrder });
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

  function updateManualPartner(i: number, patch: Partial<{ name: string; photoUrl: string; event: string }>) {
    const next = [...(form.training_partners_added || [])];
    next[i] = { ...next[i], ...patch };
    setForm({ ...form, training_partners_added: next });
  }
  function addManualPartner() {
    setForm({ ...form, training_partners_added: [...(form.training_partners_added || []), { name: "" }] });
  }
  function removeManualPartner(i: number) {
    setForm({ ...form, training_partners_added: form.training_partners_added.filter((_: any, idx: number) => idx !== i) });
  }
  function toggleSquadMateHidden(id: string, hidden: boolean) {
    const current: string[] = form.training_partners_hidden_ids || [];
    setForm({
      ...form,
      training_partners_hidden_ids: hidden ? [...current, id] : current.filter((x) => x !== id),
    });
  }

  async function toggleResultPublic(resultId: string, next: boolean) {
    setTogglingResultId(resultId);
    const { error: toggleErr } = await (supabase as any)
      .from("performances")
      .update({ is_public: next })
      .eq("id", resultId);
    setTogglingResultId(null);
    if (toggleErr) {
      alert(toggleErr.message);
      return;
    }
    refetchResults();
  }

  function updateBlogPost(i: number, patch: Partial<any>) {
    setBlogPosts((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function addBlogPost() {
    setBlogPosts((prev) => [
      { _localId: `new_${Date.now()}`, title: "", excerpt: "", content: "", cover_image_url: "", is_published: true },
      ...prev,
    ]);
  }
  async function saveBlogPost(i: number) {
    const post = blogPosts[i];
    if (!athlete) return;
    const key = post.id ?? post._localId;
    setSavingBlogKey(key);
    const payload = {
      athlete_id: athlete.id,
      title: post.title,
      excerpt: post.excerpt,
      content: post.content,
      cover_image_url: post.cover_image_url || null,
      is_published: post.is_published,
    };
    if (post.id) {
      const { error: err } = await (supabase as any).from("athlete_blog_posts").update(payload).eq("id", post.id);
      if (err) {
        alert(err.message);
        setSavingBlogKey(null);
        return;
      }
    } else {
      const { data, error: err } = await (supabase as any).from("athlete_blog_posts").insert(payload).select().single();
      if (err) {
        alert(err.message);
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
      const { error: err } = await (supabase as any).from("athlete_blog_posts").delete().eq("id", post.id);
      if (err) {
        alert(err.message);
        return;
      }
    }
    setBlogPosts((prev) => prev.filter((_, idx) => idx !== i));
    refetchBlogPosts();
  }

  if (isLoading) {
    return (
      <AppShell>
        <div className="text-sm text-muted-foreground">Loading athlete page…</div>
      </AppShell>
    );
  }
  if (error || !profile || !athlete) {
    return (
      <AppShell>
        <div className="text-sm text-muted-foreground">Athlete page not found.</div>
      </AppShell>
    );
  }

  async function handleSave() {
    setSaving(true);
    const { error: saveErr } = await (supabase as any)
      .from("athlete_profiles")
      .update({
        tagline: form.tagline,
        bio: form.bio,
        achievements: form.achievements
          .split("\n")
          .map((s: string) => s.trim())
          .filter(Boolean),
        disciplines: form.disciplines
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean),
        theme: form.theme,
        style: form.style,
        nav: form.nav,
        brand_color: form.brand_color,
        secondary_color: form.secondary_color || null,
        hero_image_side: form.hero_image_side || "right",
        section_density: form.section_density || "comfortable",
        alternate_section_backgrounds: !!form.alternate_section_backgrounds,
        hero_image_url: form.hero_image_url,
        hero_image_position_x: form.hero_image_position_x ?? 50,
        hero_image_position_y: form.hero_image_position_y ?? 50,
        gallery_images: form.gallery_images
          .split("\n")
          .map((s: string) => s.trim())
          .filter(Boolean),
        stats: (form.stats || []).filter((s: any) => s.label || s.value),
        sponsors: (form.sponsors || []).filter((s: any) => s.name || s.logo_url || s.website_url),
        donate_label: form.donate_label || null,
        donate_url: form.donate_url || null,
        training_partners_added: (form.training_partners_added || []).filter((p: any) => p.name),
        training_partners_hidden_ids: form.training_partners_hidden_ids || [],
        contact: {
          email: form.contact_email || undefined,
          instagram: form.contact_instagram || undefined,
          strava: form.contact_strava || undefined,
        },
        is_published: !!form.is_published,
        sections_enabled: form.sections,
        section_order: form.section_order || [...DEFAULT_SECTION_ORDER],
      })
      .eq("id", profile.id);
    setSaving(false);
    if (saveErr) alert(saveErr.message);
    else refetchProfile();
  }

  const profileDone = !!(form.tagline && form.bio);
  const contentDone = !!(
    (form.gallery_images || "").trim() ||
    blogPosts.some((p: any) => p.title) ||
    (form.sponsors || []).some((s: any) => s.name) ||
    form.donate_url
  );
  const resultsDone = (results || []).some((r: any) => r.is_public);
  const contactDone = !!(form.contact_email || form.contact_instagram || form.contact_strava);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-6 pb-16">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Athlete Page</h1>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={!!form.is_published} onCheckedChange={(v) => setForm({ ...form, is_published: !!v })} />
              Published
            </label>
            <Button variant="outline" asChild>
              <a href={`/a/${profile.slug}`} target="_blank" rel="noreferrer">
                Preview <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
        <p className="-mt-4 text-sm text-muted-foreground">
          Build {athlete.name}'s public page at <span className="font-mono text-xs">app.co/a/{profile.slug}</span>.
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
            <TabsTrigger value="results" className="gap-2">
              <Dot done={resultsDone} />
              Results
            </TabsTrigger>
            <TabsTrigger value="partners">Training partners</TabsTrigger>
            <TabsTrigger value="contact" className="gap-2">
              <Dot done={contactDone} />
              Contact
            </TabsTrigger>
          </TabsList>

          {/* ---------------- Profile ---------------- */}
          <TabsContent value="profile" className="mt-4 space-y-6">
            <p className="text-sm text-muted-foreground">
              Your identity: who you are, what you compete in, and the numbers that back it up.
            </p>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">About</CardTitle>
                  <CardDescription>
                    Name, primary event, and photo come from your Strider profile and can't be edited here — update
                    those on the Profile page.
                  </CardDescription>
                </div>
                <SectionToggle checked={sectionOn("about")} onCheckedChange={(v) => setSectionOn("about", v)} />
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label="Tagline" hint="Shown directly under your name in the hero — keep it to one line.">
                  <Input value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} />
                </Field>
                <Field label="Bio">
                  <Textarea rows={5} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
                </Field>
                <Field label="Achievements (one per line)">
                  <Textarea
                    rows={3}
                    value={form.achievements}
                    onChange={(e) => setForm({ ...form, achievements: e.target.value })}
                    placeholder={"State championships finalist, 1500m\nSelected for regional squad"}
                  />
                </Field>
                <Field label="Disciplines / events (comma separated)" hint="Shown as tags under your tagline.">
                  <Input
                    value={form.disciplines}
                    onChange={(e) => setForm({ ...form, disciplines: e.target.value })}
                    placeholder="Track, 1500m, 5000m"
                  />
                </Field>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">Stats</CardTitle>
                  <CardDescription>A short number strip under your hero — PBs, races this year, whatever's most credible.</CardDescription>
                </div>
                <SectionToggle checked={sectionOn("stats")} onCheckedChange={(v) => setSectionOn("stats", v)} />
              </CardHeader>
              <CardContent className="space-y-4">
                {(form.stats || []).map((s: any, i: number) => (
                  <div key={i} className="flex items-end gap-2 rounded-md border p-3">
                    <Field label="Value">
                      <Input value={s.value} onChange={(e) => updateStat(i, { value: e.target.value })} placeholder="4:19.8" />
                    </Field>
                    <Field label="Label">
                      <Input value={s.label} onChange={(e) => updateStat(i, { label: e.target.value })} placeholder="PB 1500m" />
                    </Field>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeStat(i)} className="h-9 px-2 text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addStat}>
                  <Plus className="mr-2 h-3.5 w-3.5" /> Add stat
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">Current goal</CardTitle>
                  <CardDescription>
                    Pulled live from your active primary goal — nothing to fill in here. Set or change it on the
                    Profile page's Goals card.
                  </CardDescription>
                </div>
                <SectionToggle checked={sectionOn("goal")} onCheckedChange={(v) => setSectionOn("goal", v)} />
              </CardHeader>
              <CardContent>
                {goal ? (
                  <p className="text-sm">
                    Currently showing: <span className="font-medium">{goal.title}</span>
                    {goal.race_date && ` — ${new Date(goal.race_date + "T00:00:00").toLocaleDateString()}`}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No active primary goal set yet — this section stays hidden until you add one.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Appearance ---------------- */}
          <TabsContent value="appearance" className="mt-4 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Theme &amp; branding</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <Field label="Theme">
                  <Select value={form.theme} onValueChange={(v) => setForm({ ...form, theme: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="dark">Dark</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Style">
                  <Select value={form.style} onValueChange={(v) => setForm({ ...form, style: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="modern">Modern</SelectItem>
                      <SelectItem value="traditional">Traditional</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Nav">
                  <Select value={form.nav} onValueChange={(v) => setForm({ ...form, nav: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="top">Top bar</SelectItem>
                      <SelectItem value="sidebar">Sidebar</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Brand color">
                  <Input type="color" value={form.brand_color} onChange={(e) => setForm({ ...form, brand_color: e.target.value })} className="h-10 w-20 p-1" />
                </Field>
                <Field label="Secondary color (optional)">
                  <div className="flex items-center gap-2">
                    <Input
                      type="color"
                      value={form.secondary_color || "#BD4130"}
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
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field label="Hero image side" hint="Only affects the Modern style.">
                  <Select value={form.hero_image_side || "right"} onValueChange={(v) => setForm({ ...form, hero_image_side: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="right">Image on the right</SelectItem>
                      <SelectItem value="left">Image on the left</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Section spacing">
                  <Select value={form.section_density || "comfortable"} onValueChange={(v) => setForm({ ...form, section_density: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="comfortable">Comfortable</SelectItem>
                      <SelectItem value="compact">Compact</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2">
                  <div>
                    <div className="text-sm font-medium">Alternate section backgrounds</div>
                    <p className="text-xs text-muted-foreground">Every other section gets a subtle grey tint.</p>
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
                <CardDescription>Drag to reorder. Home always comes first.</CardDescription>
              </CardHeader>
              <CardContent>
                <SectionOrderList
                  order={form.section_order || [...DEFAULT_SECTION_ORDER]}
                  labels={SECTION_ORDER_LABELS}
                  isOn={(key) => sectionOn(key)}
                  onReorder={reorderSections}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Content ---------------- */}
          <TabsContent value="content" className="mt-4 space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">Gallery</CardTitle>
                </div>
                <SectionToggle checked={sectionOn("gallery")} onCheckedChange={(v) => setSectionOn("gallery", v)} />
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
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">Blog</CardTitle>
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
                            <Checkbox checked={!!p.is_published} onCheckedChange={(v) => updateBlogPost(i, { is_published: !!v })} />
                            Published
                          </label>
                          <Button type="button" variant="ghost" size="sm" onClick={() => deleteBlogPost(i)} className="h-7 px-2 text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <Field label="Title">
                        <Input value={p.title} onChange={(e) => updateBlogPost(i, { title: e.target.value })} />
                      </Field>
                      <Field label="Excerpt">
                        <Textarea rows={2} value={p.excerpt} onChange={(e) => updateBlogPost(i, { excerpt: e.target.value })} />
                      </Field>
                      <Field label="Full content">
                        <Textarea rows={6} value={p.content} onChange={(e) => updateBlogPost(i, { content: e.target.value })} />
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
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">Sponsors</CardTitle>
                </div>
                <SectionToggle checked={sectionOn("sponsors")} onCheckedChange={(v) => setSectionOn("sponsors", v)} />
              </CardHeader>
              <CardContent className="space-y-4">
                {(form.sponsors || []).map((s: any, i: number) => (
                  <div key={i} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Sponsor {i + 1}</span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeSponsor(i)} className="h-7 px-2 text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <Field label="Name">
                      <Input value={s.name} onChange={(e) => updateSponsor(i, { name: e.target.value })} />
                    </Field>
                    <Field label="Website URL">
                      <Input value={s.website_url} onChange={(e) => updateSponsor(i, { website_url: e.target.value })} />
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
                  <CardTitle className="text-base">Support / donate</CardTitle>
                  <CardDescription>
                    A link-out button to a platform you already use (Ko-fi, Patreon, Buy Me a Coffee, GoFundMe,
                    PayPal.me) — not a payment system built into Strider.
                  </CardDescription>
                </div>
                <SectionToggle checked={sectionOn("donate")} onCheckedChange={(v) => setSectionOn("donate", v)} />
              </CardHeader>
              <CardContent className="space-y-3">
                <Field label="Link URL">
                  <Input
                    value={form.donate_url}
                    onChange={(e) => setForm({ ...form, donate_url: e.target.value })}
                    placeholder="https://ko-fi.com/yourname"
                  />
                </Field>
                <Field label="Message (optional)">
                  <Input
                    value={form.donate_label}
                    onChange={(e) => setForm({ ...form, donate_label: e.target.value })}
                    placeholder="Training, travel, and race fees add up — every bit helps."
                  />
                </Field>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Results ---------------- */}
          <TabsContent value="results" className="mt-4 space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">Personal bests &amp; results</CardTitle>
                  <CardDescription>
                    Only performances logged as a race show up here — training runs and time trials never appear on
                    this list. Nothing is public until you switch it on below; toggling saves immediately.
                  </CardDescription>
                </div>
                <SectionToggle checked={sectionOn("results")} onCheckedChange={(v) => setSectionOn("results", v)} />
              </CardHeader>
              <CardContent>
                {!results || results.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No race results logged yet — add them from the Profile page's performances card.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {results.map((r: any) => (
                      <label key={r.id} className="flex items-center gap-3 rounded-md border p-3 text-sm">
                        <Checkbox
                          checked={r.is_public}
                          disabled={togglingResultId === r.id}
                          onCheckedChange={(v) => toggleResultPublic(r.id, !!v)}
                        />
                        <span className="flex-1">
                          {r.event_name || "Race"} — {r.distance_m}m
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(r.performance_date + "T00:00:00").toLocaleDateString()}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Training partners ---------------- */}
          <TabsContent value="partners" className="mt-4 space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">Training partners</CardTitle>
                  <CardDescription>
                    Athletes who share a coach with you are added automatically. Uncheck anyone you don't train with
                    directly, or add someone outside the app below.
                  </CardDescription>
                </div>
                <SectionToggle checked={sectionOn("trainingPartners")} onCheckedChange={(v) => setSectionOn("trainingPartners", v)} />
              </CardHeader>
              <CardContent className="space-y-4">
                {!squadMates || squadMates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No squad-mates found via a shared coach yet.</p>
                ) : (
                  <div className="space-y-2">
                    {squadMates.map((m: any) => {
                      const hidden = (form.training_partners_hidden_ids || []).includes(m.id);
                      return (
                        <label key={m.id} className="flex items-center gap-3 rounded-md border p-3 text-sm">
                          <Checkbox checked={!hidden} onCheckedChange={(v) => toggleSquadMateHidden(m.id, !v)} />
                          <span className="flex-1">{m.name}</span>
                          {m.event && <span className="text-xs text-muted-foreground">{m.event}</span>}
                        </label>
                      );
                    })}
                  </div>
                )}

                <div className="pt-2">
                  <div className="mb-2 text-xs font-medium text-muted-foreground">Add someone outside the app</div>
                  {(form.training_partners_added || []).map((p: any, i: number) => (
                    <div key={i} className="mb-2 flex items-end gap-2 rounded-md border p-3">
                      <Field label="Name">
                        <Input value={p.name} onChange={(e) => updateManualPartner(i, { name: e.target.value })} />
                      </Field>
                      <Field label="Event (optional)">
                        <Input value={p.event || ""} onChange={(e) => updateManualPartner(i, { event: e.target.value })} />
                      </Field>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeManualPartner(i)} className="h-9 px-2 text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={addManualPartner}>
                    <Plus className="mr-2 h-3.5 w-3.5" /> Add partner
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Contact ---------------- */}
          <TabsContent value="contact" className="mt-4 space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">Contact</CardTitle>
                </div>
                <SectionToggle checked={sectionOn("contact")} onCheckedChange={(v) => setSectionOn("contact", v)} />
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field label="Email">
                  <Input value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
                </Field>
                <Field label="Instagram handle">
                  <Input value={form.contact_instagram} onChange={(e) => setForm({ ...form, contact_instagram: e.target.value })} placeholder="@yourname" />
                </Field>
                <Field label="Strava profile URL">
                  <Input value={form.contact_strava} onChange={(e) => setForm({ ...form, contact_strava: e.target.value })} placeholder="https://strava.com/athletes/..." />
                </Field>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function SectionToggle({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (v: boolean) => void }) {
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
