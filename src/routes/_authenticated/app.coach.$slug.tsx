import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mail, AtSign, MapPin } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/coach/$slug")({
  component: CoachProfilePage,
});

type Json = any;

function useCoachProfile(slug: string) {
  return useQuery({
    queryKey: ["coach-profile", slug],
    queryFn: async () => {
      const { data, error } = await supabase.from("coach_profiles").select("*").eq("slug", slug).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

function asArray(v: Json): any[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") return Object.entries(v).map(([k, val]) => ({ key: k, value: val }));
  return [];
}

function CoachProfilePage() {
  const { slug } = useParams({ from: "/_authenticated/app/coach/$slug" });
  const { data: coach, isLoading, error } = useCoachProfile(slug);

  // ✅ STEP 1 — editing state
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});

  // ✅ STEP 2 — populate form when coach loads
  useEffect(() => {
    if (coach) {
      setForm({
        name: coach.name || "",
        tagline: coach.tagline || "",
        bio: coach.bio || "",
        disciplines: coach.disciplines || [],
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

  const stats = asArray(coach.stats);
  const sampleSessions = asArray(coach.sample_sessions);
  const plans = asArray(coach.plans);
  const testimonials = asArray(coach.testimonials);
  const contact = (coach.contact ?? {}) as Record<string, any>;
  const location = (coach.location ?? {}) as Record<string, any>;
  const locationText = [location.city, location.region, location.country].filter(Boolean).join(", ");

  return (
    <AppShell>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6 min-w-0">
          {/* Hero */}
          <section
            className="relative overflow-hidden rounded-xl border border-border p-6 md:p-10"
            style={
              coach.brand_color
                ? { background: `linear-gradient(135deg, ${coach.brand_color}22, transparent)` }
                : undefined
            }
          >
            {coach.hero_image_url && (
              <img
                src={coach.hero_image_url}
                alt={coach.name ?? "Coach"}
                className="absolute inset-0 h-full w-full object-cover opacity-20"
              />
            )}
            <div className="relative">
              <div className="flex items-center justify-between gap-4">
                {editing ? (
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="text-3xl md:text-4xl font-bold tracking-tight border rounded px-2 py-1 w-full"
                  />
                ) : (
                  <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{coach.name}</h1>
                )}

                <Button size="sm" onClick={() => setEditing((v) => !v)}>
                  {editing ? "Cancel" : "Edit Profile"}
                </Button>
              </div>

              {coach.tagline && <p className="mt-2 text-lg text-muted-foreground">{coach.tagline}</p>}
              {Array.isArray(coach.disciplines) && coach.disciplines.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {coach.disciplines.map((d: string) => (
                    <Badge key={d} variant="secondary">
                      {d}
                    </Badge>
                  ))}
                </div>
              )}
              {locationText && (
                <div className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" /> {locationText}
                </div>
              )}
            </div>
          </section>

          {/* Stats */}
          {stats.length > 0 && (
            <section>
              <h2 className="text-xl font-semibold mb-3">Stats</h2>
              <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {stats.map((s: any, i: number) => {
                  const label = s.label ?? s.key ?? s.name;
                  const value = s.value ?? s.stat ?? s.number;
                  return (
                    <Card key={i}>
                      <CardContent className="p-4">
                        <div className="text-2xl font-bold">{String(value ?? "—")}</div>
                        <div className="text-xs text-muted-foreground uppercase tracking-wide mt-1">
                          {String(label ?? "")}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}

          {/* About */}
          {coach.bio && (
            <section>
              <h2 className="text-xl font-semibold mb-3">About</h2>
              <Card>
                <CardContent className="p-6 whitespace-pre-wrap text-sm leading-relaxed">{coach.bio}</CardContent>
              </Card>
            </section>
          )}

          {/* Sample Sessions */}
          {sampleSessions.length > 0 && (
            <section>
              <h2 className="text-xl font-semibold mb-3">Sample Sessions</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {sampleSessions.map((s: any, i: number) => (
                  <Card key={i}>
                    <CardHeader>
                      <CardTitle className="text-base">{s.name ?? `Session ${i + 1}`}</CardTitle>
                      {s.target && <CardDescription>Target: {s.target}</CardDescription>}
                    </CardHeader>
                    {s.purpose && <CardContent className="text-sm text-muted-foreground">{s.purpose}</CardContent>}
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* Plans */}
          {plans.length > 0 && (
            <section>
              <h2 className="text-xl font-semibold mb-3">Plans</h2>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {plans.map((p: any, i: number) => (
                  <Card key={i} className="flex flex-col">
                    <CardHeader>
                      <CardTitle className="text-base">{p.name ?? p.title ?? `Plan ${i + 1}`}</CardTitle>
                      {p.price != null && (
                        <div className="text-2xl font-bold mt-1">
                          {typeof p.price === "number" ? `$${p.price}` : String(p.price)}
                          {p.interval && (
                            <span className="text-sm font-normal text-muted-foreground"> / {p.interval}</span>
                          )}
                        </div>
                      )}
                      {p.description && <CardDescription>{p.description}</CardDescription>}
                    </CardHeader>
                    {Array.isArray(p.features) && p.features.length > 0 && (
                      <CardContent className="text-sm">
                        <ul className="space-y-1 list-disc pl-4">
                          {p.features.map((f: string, j: number) => (
                            <li key={j}>{f}</li>
                          ))}
                        </ul>
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* Testimonials */}
          {testimonials.length > 0 && (
            <section>
              <h2 className="text-xl font-semibold mb-3">Testimonials</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {testimonials.map((t: any, i: number) => (
                  <Card key={i}>
                    <CardContent className="p-6">
                      <p className="text-sm italic">"{t.quote ?? t.text ?? t.body ?? ""}"</p>
                      {(t.name || t.author) && (
                        <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          — {t.name ?? t.author}
                          {t.role && <span className="font-normal normal-case"> · {t.role}</span>}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Sidebar: Contact */}
        <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {contact.email ? (
                <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-sm hover:underline">
                  <Mail className="h-4 w-4" /> {contact.email}
                </a>
              ) : null}
              {contact.instagram ? (
                <a
                  href={`https://instagram.com/${String(contact.instagram).replace(/^@/, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-sm hover:underline"
                >
                  <AtSign className="h-4 w-4" /> @{String(contact.instagram).replace(/^@/, "")}
                </a>
              ) : null}
              {!contact.email && !contact.instagram && (
                <p className="text-sm text-muted-foreground">No contact info provided.</p>
              )}
              {contact.email && (
                <Button asChild size="sm" className="w-full mt-2">
                  <a href={`mailto:${contact.email}`}>Get in touch</a>
                </Button>
              )}
            </CardContent>
          </Card>

          {Array.isArray(coach.certifications) && coach.certifications.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Certifications</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {coach.certifications.map((c: string) => (
                    <li key={c}>· {c}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
