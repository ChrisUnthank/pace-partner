import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyRoles } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Palette,
  Upload,
  X,
  Lock,
  AlertTriangle,
  Home,
  CalendarDays,
  LineChart,
  Zap,
} from "lucide-react";
import { isValidHex, readableForeground, contrastRatioWithWhite } from "@/lib/branding";
import { logAccountActivity } from "@/lib/account-activity-log";

export const Route = createFileRoute("/_authenticated/app/branding")({
  component: BrandingPage,
});

// Same public bucket the Coach Public Page image uploader already writes to.
// Public (not signed) is deliberate and necessary here: a brand logo renders
// in the app chrome on every page for every athlete on the roster, and signed
// URLs would need continual refreshing to keep doing that.
const BUCKET = "coach-media";
const MAX_BYTES = 2 * 1024 * 1024;

const STRIDER_RED = "#FF004C";

interface BrandingForm {
  enabled: boolean;
  app_name: string;
  logo_url: string;
  logo_mark_url: string;
  logo_initials: string;
  brand_color: string;
  default_theme: "user" | "dark" | "light";
  force_theme: boolean;
  support_email: string;
}

const EMPTY: BrandingForm = {
  enabled: false,
  app_name: "",
  logo_url: "",
  logo_mark_url: "",
  logo_initials: "",
  brand_color: STRIDER_RED,
  default_theme: "user",
  force_theme: false,
  support_email: "",
};

async function uploadImage(userId: string, file: File): Promise<string> {
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${userId}/branding-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function BrandingPage() {
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const qc = useQueryClient();

  const [form, setForm] = useState<BrandingForm>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  // Entitlement is read here for MESSAGING ONLY — to tell the coach whether
  // what they're configuring is actually live yet. The real gate runs
  // server-side inside get_effective_branding(); nothing on this page can
  // turn the feature on for anyone.
  const { data: profile } = useQuery({
    queryKey: ["my-white-label-entitlement", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("profiles")
        .select("white_label_active")
        .eq("id", user!.id)
        .maybeSingle();
      return data;
    },
  });
  const entitled = profile?.white_label_active === true;

  const { data: row, isLoading } = useQuery({
    queryKey: ["coach-branding", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("coach_branding")
        .select("*")
        .eq("coach_user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (isLoading || loaded) return;
    if (row) {
      setForm({
        enabled: !!row.enabled,
        app_name: row.app_name ?? "",
        logo_url: row.logo_url ?? "",
        logo_mark_url: row.logo_mark_url ?? "",
        logo_initials: row.logo_initials ?? "",
        brand_color: row.brand_color ?? STRIDER_RED,
        default_theme: (row.default_theme ?? "user") as BrandingForm["default_theme"],
        force_theme: !!row.force_theme,
        support_email: row.support_email ?? "",
      });
    }
    setLoaded(true);
  }, [row, isLoading, loaded]);

  const colorValid = isValidHex(form.brand_color);
  const contrast = colorValid ? contrastRatioWithWhite(form.brand_color) : 0;
  // Below ~3:1 against white, white text on the brand colour is unreadable.
  // The app flips to near-black text automatically at that point (see
  // readableForeground), so this is a heads-up rather than an error — but a
  // coach should know their colour is going to behave differently.
  const lowContrast = colorValid && contrast < 3;

  async function save() {
    if (!user) return;
    if (!colorValid) {
      toast.error("Brand colour must be a 6-digit hex value, e.g. #1D4ED8");
      return;
    }
    if (form.enabled && !form.app_name.trim()) {
      toast.error("Give your brand a name before turning it on");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        coach_user_id: user.id,
        enabled: form.enabled,
        app_name: form.app_name.trim() || null,
        logo_url: form.logo_url.trim() || null,
        logo_mark_url: form.logo_mark_url.trim() || null,
        logo_initials: form.logo_initials.trim().toUpperCase() || null,
        brand_color: form.brand_color,
        default_theme: form.default_theme,
        force_theme: form.force_theme,
        support_email: form.support_email.trim() || null,
      };
      const { error } = await (supabase as any)
        .from("coach_branding")
        .upsert(payload, { onConflict: "coach_user_id" });
      if (error) throw error;

      toast.success(form.enabled ? "Branding saved and live" : "Branding saved (not live yet)");
      logAccountActivity(
        user.id,
        "branding_updated",
        `In-app branding updated (${form.enabled ? "live" : "off"})`,
        { enabled: form.enabled },
      );
      // Repaints this session immediately; every athlete picks it up on
      // their next load. Both keys matter — the editor row and the resolved
      // branding the whole app reads from.
      qc.invalidateQueries({ queryKey: ["coach-branding", user.id] });
      qc.invalidateQueries({ queryKey: ["effective-branding", user.id] });
    } catch (e: any) {
      toast.error(e.message ?? "Could not save branding");
    } finally {
      setSaving(false);
    }
  }

  if (!isCoach) {
    return (
      <AppShell>
        <PageHeader />
        <Card className="mt-6">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Branding is a coach setting. If your coach has set up their own branding, you'll already be seeing it
              — there's nothing for you to configure here.
            </p>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-6xl">
        <PageHeader />

        {!entitled && (
          <Card className="border-[var(--accent-red)]/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Lock className="h-4 w-4 text-[var(--accent-red)]" />
                Not active on your plan yet
              </CardTitle>
              <CardDescription>
                You can set everything up and preview it here now, and it'll save. But until white-labelling is
                enabled on your account, you and your athletes will keep seeing Strider — nothing below goes live.
                Get in touch to upgrade.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
          <div className="space-y-6">
            {/* ── Live switch ──────────────────────────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Turn branding on</CardTitle>
                <CardDescription>
                  When this is on, your brand replaces Strider's name, logo, and colour throughout the app — for you
                  and for every athlete on your roster (and their linked parents) when they log in. Leave it off
                  while you're still setting things up.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <label className="flex items-center gap-3 cursor-pointer">
                  <Switch
                    checked={form.enabled}
                    onCheckedChange={(v) => setForm({ ...form, enabled: v })}
                  />
                  <span className="text-sm font-medium">
                    {form.enabled ? "Branding is on" : "Branding is off"}
                  </span>
                </label>
              </CardContent>
            </Card>

            {/* ── Identity ─────────────────────────────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Name &amp; logo</CardTitle>
                <CardDescription>
                  The wide logo is used in the expanded sidebar. The square mark is used wherever there's no room for
                  a wide one — the collapsed sidebar and the mobile header. If you only upload one, upload the square
                  mark.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label>Brand name</Label>
                    <Input
                      className="mt-1"
                      maxLength={40}
                      value={form.app_name}
                      onChange={(e) => setForm({ ...form, app_name: e.target.value })}
                      placeholder="Apex Endurance"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Shown wherever "Strider" appears in the app chrome.</p>
                  </div>
                  <div>
                    <Label>Initials fallback</Label>
                    <Input
                      className="mt-1"
                      maxLength={3}
                      value={form.logo_initials}
                      onChange={(e) => setForm({ ...form, logo_initials: e.target.value.toUpperCase() })}
                      placeholder="AE"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Used on the brand-colour tile if you don't upload a square mark. Up to 3 characters.
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <ImageField
                    label="Wide logo"
                    hint="Transparent PNG or SVG works best. Roughly 4:1."
                    userId={user?.id}
                    value={form.logo_url}
                    onChange={(v) => setForm({ ...form, logo_url: v })}
                    aspect="h-16"
                  />
                  <ImageField
                    label="Square mark"
                    hint="A square icon version, at least 128×128."
                    userId={user?.id}
                    value={form.logo_mark_url}
                    onChange={(v) => setForm({ ...form, logo_mark_url: v })}
                    aspect="h-16 w-16"
                  />
                </div>
              </CardContent>
            </Card>

            {/* ── Colour ───────────────────────────────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Brand colour</CardTitle>
                <CardDescription>
                  Replaces Strider red on buttons, active nav, highlights, and the first chart series. Warning and
                  delete actions stay red on purpose — those need to read as danger no matter what your brand colour
                  is.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-end gap-3">
                  <div>
                    <Label>Colour</Label>
                    <Input
                      type="color"
                      className="mt-1 h-10 w-20 p-1"
                      value={colorValid ? form.brand_color : STRIDER_RED}
                      onChange={(e) => setForm({ ...form, brand_color: e.target.value.toUpperCase() })}
                    />
                  </div>
                  <div className="flex-1 max-w-[180px]">
                    <Label>Hex</Label>
                    <Input
                      className={cn("mt-1 font-mono", !colorValid && "border-destructive")}
                      value={form.brand_color}
                      onChange={(e) => setForm({ ...form, brand_color: e.target.value.toUpperCase() })}
                      placeholder="#FF004C"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setForm({ ...form, brand_color: STRIDER_RED })}
                  >
                    Reset to Strider red
                  </Button>
                </div>
                {!colorValid && (
                  <p className="text-xs text-destructive">Needs to be a 6-digit hex value, e.g. #1D4ED8.</p>
                )}
                {lowContrast && (
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-[var(--accent-red)]" />
                    That's a light colour — text sitting on it will switch to dark automatically so it stays
                    readable, which changes the look of buttons a little. Worth checking the preview.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* ── Appearance ───────────────────────────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Default appearance</CardTitle>
                <CardDescription>
                  Which of light or dark your athletes start on. This is a starting point, not a lock — anyone who's
                  already chosen their own keeps it, unless you lock it below.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="max-w-[220px]">
                  <Label>Appearance</Label>
                  <Select
                    value={form.default_theme}
                    onValueChange={(v) => setForm({ ...form, default_theme: v as BrandingForm["default_theme"] })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">Let each person choose</SelectItem>
                      <SelectItem value="dark">Dark</SelectItem>
                      <SelectItem value="light">Light</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <label
                  className={cn(
                    "flex items-start gap-3",
                    form.default_theme === "user" ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
                  )}
                >
                  <Switch
                    checked={form.force_theme}
                    disabled={form.default_theme === "user"}
                    onCheckedChange={(v) => setForm({ ...form, force_theme: v })}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium">Lock everyone to this appearance</div>
                    <div className="text-xs text-muted-foreground">
                      Overrides personal choices, and greys out the toggle on their Account page. Worth thinking
                      twice about — some people choose light or dark for eye strain or visual reasons, not
                      preference.
                    </div>
                  </div>
                </label>
              </CardContent>
            </Card>

            {/* ── Support contact ──────────────────────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Support contact</CardTitle>
                <CardDescription>
                  Optional. Where your athletes should go for help, instead of Strider.
                </CardDescription>
              </CardHeader>
              <CardContent className="max-w-sm">
                <Label>Email</Label>
                <Input
                  className="mt-1"
                  type="email"
                  value={form.support_email}
                  onChange={(e) => setForm({ ...form, support_email: e.target.value })}
                  placeholder="coach@apexendurance.com"
                />
              </CardContent>
            </Card>

            <div className="flex items-center gap-3">
              <Button onClick={save} disabled={saving || isLoading}>
                {saving ? "Saving…" : "Save branding"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Your own view updates right away. Athletes pick it up next time they load the app.
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              A small "Powered by Strider" line stays in the sidebar and on the Account page while branding is
              active. That part isn't removable.
            </p>
          </div>

          {/* ── Live preview ───────────────────────────────────────────── */}
          <div className="lg:sticky lg:top-20">
            <BrandPreview form={form} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function PageHeader() {
  return (
    <div className="flex items-center gap-3">
      <div className="h-10 w-10 shrink-0 rounded-lg grid place-items-center" style={{ background: "var(--accent-red)" }}>
        <Palette className="h-5 w-5 text-[var(--primary-foreground)]" strokeWidth={2} />
      </div>
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Premium</div>
        <h1 className="text-2xl font-bold leading-tight">Branding</h1>
      </div>
    </div>
  );
}

function ImageField({
  label,
  hint,
  userId,
  value,
  onChange,
  aspect,
}: {
  label: string;
  hint: string;
  userId?: string;
  value: string;
  onChange: (url: string) => void;
  aspect: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !userId) return;
    if (f.size > MAX_BYTES) {
      toast.error("Logo must be 2MB or less");
      return;
    }
    setBusy(true);
    try {
      onChange(await uploadImage(userId, f));
    } catch (err: any) {
      toast.error(err.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 flex items-center gap-3">
        {value ? (
          <div className={cn("relative shrink-0 rounded-md border bg-muted/40 p-1", aspect)}>
            <img src={value} alt={label} className="h-full w-full object-contain" />
            <button
              type="button"
              onClick={() => onChange("")}
              className="absolute -right-2 -top-2 rounded-full border border-border bg-background p-1"
              aria-label={`Remove ${label}`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div
            className={cn(
              "grid shrink-0 place-items-center rounded-md border border-dashed text-[10px] text-muted-foreground",
              aspect,
              aspect.includes("w-") ? "" : "w-32",
            )}
          >
            None
          </div>
        )}
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={pick} />
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          {busy ? "Uploading…" : value ? "Replace" : "Upload"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mt-1">{hint}</p>
    </div>
  );
}

/**
 * Scoped preview. Deliberately does NOT touch the document-level CSS
 * variables the real branding uses — those are set on <html> and would
 * repaint the whole editor while typing, which makes it impossible to tell
 * what you're actually changing. Instead the same variable names are
 * re-declared on this wrapper, so everything inside inherits the in-progress
 * brand while the surrounding page stays on the current live one.
 */
function BrandPreview({ form }: { form: BrandingForm }) {
  const color = isValidHex(form.brand_color) ? form.brand_color : STRIDER_RED;
  const fg = readableForeground(color);
  const name = form.app_name.trim() || "Strider";
  const initials = form.logo_initials.trim() || name.charAt(0).toUpperCase();

  const items = [
    { icon: Home, label: "Home", active: true },
    { icon: CalendarDays, label: "Training", active: false },
    { icon: LineChart, label: "Metrics", active: false },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Preview</CardTitle>
        <CardDescription>How the app chrome will look to you and your athletes.</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className="overflow-hidden rounded-lg border border-border"
          style={
            {
              "--accent-red": color,
              "--primary": color,
              "--primary-foreground": fg,
            } as React.CSSProperties
          }
        >
          <div className="flex">
            {/* Sidebar */}
            <div className="w-32 shrink-0 border-r border-border bg-sidebar">
              <div className="flex h-11 items-center gap-1.5 border-b border-border px-2">
                {form.logo_mark_url ? (
                  <img src={form.logo_mark_url} alt="" className="h-5 w-5 rounded object-contain" />
                ) : (
                  <span
                    className="grid h-5 w-5 place-items-center rounded"
                    style={{ background: color, color: fg }}
                  >
                    {form.app_name.trim() || form.logo_initials.trim() ? (
                      <span className="text-[9px] font-extrabold">{initials}</span>
                    ) : (
                      <Zap className="h-3 w-3" strokeWidth={2.5} />
                    )}
                  </span>
                )}
                <span className="truncate font-display text-[10px] font-extrabold uppercase tracking-tight">
                  {name}
                </span>
              </div>
              <div className="space-y-0.5 p-1.5">
                {items.map((it) => (
                  <div
                    key={it.label}
                    className={cn(
                      "relative flex items-center gap-1.5 rounded px-1.5 py-1 text-[10px] font-medium",
                      it.active ? "bg-sidebar-accent text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {it.active && (
                      <span
                        className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full"
                        style={{ background: color }}
                      />
                    )}
                    <it.icon className="h-3 w-3" style={it.active ? { color } : undefined} />
                    {it.label}
                  </div>
                ))}
              </div>
              <div className="px-1.5 pb-1.5 pt-2 text-[8px] text-muted-foreground/70">Powered by Strider</div>
            </div>

            {/* Main */}
            <div className="min-w-0 flex-1 bg-background">
              <div className="flex h-11 items-center border-b border-border px-2 text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                <span className="truncate">{name}</span>
                <span className="px-1 text-border">/</span>
                <span className="text-foreground">Home</span>
              </div>
              <div className="space-y-2 p-2.5">
                <div className="h-2 w-2/3 rounded bg-muted" />
                <div className="h-2 w-1/2 rounded bg-muted" />
                <div className="flex gap-1.5 pt-1">
                  <span
                    className="rounded px-2 py-1 text-[9px] font-semibold"
                    style={{ background: color, color: fg }}
                  >
                    Primary
                  </span>
                  <span className="rounded border border-border px-2 py-1 text-[9px] font-semibold">Secondary</span>
                  <span className="rounded bg-destructive px-2 py-1 text-[9px] font-semibold text-destructive-foreground">
                    Delete
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Note the Delete button stays red — danger actions never take the brand colour.
        </p>
      </CardContent>
    </Card>
  );
}
