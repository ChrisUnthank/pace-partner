import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Strider — Training tracker for middle-distance runners" },
      { name: "description", content: "Plan sessions, log every rep and recovery, monitor daily readiness, and track athlete progression for 800m–5000m runners and their coaches." },
      { property: "og:title", content: "Strider" },
      { property: "og:description", content: "Training tracker for middle-distance runners and coaches." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/app" });
    });
  }, [navigate]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <span className="font-semibold">Strider</span>
          <Button asChild size="sm"><Link to="/auth">Sign in</Link></Button>
        </div>
      </header>
      <main className="flex-1">
        <section className="max-w-3xl mx-auto px-4 py-20 text-center">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Training tracking for middle-distance runners.</h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Plan sessions rep-by-rep, log every recovery, monitor daily readiness, and let the data tell you when to push and when to back off. Built for 800m–5000m athletes and the coaches who guide them.
          </p>
          <div className="mt-8 flex gap-3 justify-center">
            <Button asChild size="lg"><Link to="/auth">Get started</Link></Button>
          </div>
        </section>
        <section className="max-w-5xl mx-auto px-4 grid md:grid-cols-3 gap-6 pb-20">
          {[
            { t: "Rep-level detail", d: "Every rep and every recovery as its own row — time or distance, HR end, HR recovery, mode (standing / walk / jog / float)." },
            { t: "Daily readiness", d: "Sleep, soreness, stress, fuel, plus life load — work, gym, sport, school. Combined load drives a green / amber / red signal." },
            { t: "Coach-led adjustments", d: "When readiness drops, the rulebook suggests an alternative session for the coach to approve." },
          ].map((f) => (
            <div key={f.t} className="p-6 border rounded-lg bg-card">
              <h3 className="font-semibold">{f.t}</h3>
              <p className="text-sm text-muted-foreground mt-2">{f.d}</p>
            </div>
          ))}
        </section>
      </main>
      <footer className="border-t py-6 text-center text-sm text-muted-foreground">Strider · v0.1</footer>
    </div>
  );
}
