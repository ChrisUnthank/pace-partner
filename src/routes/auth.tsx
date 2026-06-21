import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Strider" },
      { name: "description", content: "Sign in to manage middle-distance training sessions, daily check-ins, and athlete progression." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"athlete" | "coach" | "manager">("athlete");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/app" });
    });
  }, [navigate]);

  async function ensureRole(userId: string, r: "athlete" | "coach" | "manager") {
    const { error: roleErr } = await supabase
      .from("user_roles")
      .upsert({ user_id: userId, role: r }, { onConflict: "user_id,role" });
    if (roleErr) throw roleErr;
    if (r === "athlete") {
      const { data: existing } = await supabase.from("athletes").select("id").eq("user_id", userId).maybeSingle();
      if (!existing) {
        await supabase.from("athletes").insert({
          user_id: userId,
          name: fullName || email.split("@")[0],
          created_by: userId,
        });
      }
    }
  }

  async function signUp() {
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin, data: { full_name: fullName } },
      });
      if (error) throw error;
      if (data.user) await ensureRole(data.user.id, role);
      toast.success("Account created");
      navigate({ to: "/app" });
    } catch (e: any) {
      toast.error(e.message ?? "Sign up failed");
    } finally {
      setBusy(false);
    }
  }

  async function signIn() {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate({ to: "/app" });
    } catch (e: any) {
      toast.error(e.message ?? "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    const res = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (res.error) toast.error("Google sign-in failed");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Strider</CardTitle>
          <CardDescription>Training tracking for middle-distance runners and their coaches.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="signin">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Sign up</TabsTrigger>
            </TabsList>
            <TabsContent value="signin" className="space-y-3 pt-4">
              <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
              <Button className="w-full" disabled={busy} onClick={signIn}>Sign in</Button>
              <Button variant="outline" className="w-full" onClick={google}>Continue with Google</Button>
            </TabsContent>
            <TabsContent value="signup" className="space-y-3 pt-4">
              <div><Label>Full name</Label><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
              <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
              <div>
                <Label>I am a…</Label>
                <RadioGroup value={role} onValueChange={(v) => setRole(v as any)} className="flex flex-wrap gap-4 mt-2">
                  <label className="flex items-center gap-2 cursor-pointer"><RadioGroupItem value="athlete" /> Athlete</label>
                  <label className="flex items-center gap-2 cursor-pointer"><RadioGroupItem value="coach" /> Coach</label>
                  <label className="flex items-center gap-2 cursor-pointer"><RadioGroupItem value="manager" /> Manager</label>
                </RadioGroup>
                <p className="text-xs text-muted-foreground mt-1">Manager = team/squad admin with coach-level access to every athlete.</p>
              </div>
              <Button className="w-full" disabled={busy} onClick={signUp}>Create account</Button>
              <Button variant="outline" className="w-full" onClick={google}>Continue with Google</Button>
              <p className="text-xs text-muted-foreground">Google sign-in defaults to the Athlete role — change later in your profile.</p>
            </TabsContent>
          </Tabs>
          <p className="mt-6 text-xs text-center text-muted-foreground">
            <Link to="/" className="underline">Back to home</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}