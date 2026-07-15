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
      {
        name: "description",
        content: "Sign in to manage middle-distance training sessions, daily check-ins, and athlete progression.",
      },
    ],
  }),
  component: AuthPage,
});

// Supabase's password-reset email lands back on this same /auth route with a
// recovery token in the URL (hash for the implicit flow, query string if the
// project uses PKCE) — checking for it lets us skip the normal auto-redirect
// and instead wait for the PASSWORD_RECOVERY auth event below.
function isRecoveryLink() {
  if (typeof window === "undefined") return false;
  return window.location.hash.includes("type=recovery") || window.location.search.includes("type=recovery");
}

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"athlete" | "coach" | "manager">("athlete");
  const [busy, setBusy] = useState(false);

  // Forgot password / temporary magic-link re-login
  const [showForgot, setShowForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [sendingReset, setSendingReset] = useState(false);
  const [sendingMagic, setSendingMagic] = useState(false);

  // Password recovery landing (after clicking the emailed reset link)
  const [isRecovery, setIsRecovery] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [settingPassword, setSettingPassword] = useState(false);

  useEffect(() => {
    const recoveryLink = isRecoveryLink();

    supabase.auth.getSession().then(({ data }) => {
      if (data.session && !recoveryLink) navigate({ to: "/app" });
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
      } else if (event === "SIGNED_IN" && !isRecoveryLink()) {
        navigate({ to: "/app" });
      }
    });

    return () => subscription.unsubscribe();
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

  async function sendResetLink() {
    const target = resetEmail.trim();

    if (!target) {
      toast.error("Enter your email first");
      return;
    }

    setSendingReset(true);
    const { error } = await supabase.auth.resetPasswordForEmail(target, {
      redirectTo: `${window.location.origin}/auth`,
    });
    setSendingReset(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Check your email for a password reset link");
  }

  // Temporary stopgap: signs the person straight in via a one-time emailed
  // link, no password needed. Handy right now if someone's locked out and
  // needs back in immediately, ahead of the reset-link flow above finishing
  // its round trip.
  async function sendMagicLink() {
    const target = resetEmail.trim();

    if (!target) {
      toast.error("Enter your email first");
      return;
    }

    setSendingMagic(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: target,
      options: { emailRedirectTo: `${window.location.origin}/app` },
    });
    setSendingMagic(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Check your email for a one-time sign-in link");
  }

  async function setNewPasswordAfterRecovery() {
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    if (newPassword !== confirmNewPassword) {
      toast.error("Passwords don't match");
      return;
    }

    setSettingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSettingPassword(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Password updated");
    navigate({ to: "/app" });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Strider</CardTitle>
          <CardDescription>Training tracking for middle-distance runners and their coaches.</CardDescription>
        </CardHeader>
        <CardContent>
          {isRecovery ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Enter a new password for your account.</p>

              <div>
                <Label>New password</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                />
              </div>

              <div>
                <Label>Confirm new password</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                />
              </div>

              <Button className="w-full" disabled={settingPassword} onClick={setNewPasswordAfterRecovery}>
                {settingPassword ? "Updating..." : "Set new password"}
              </Button>
            </div>
          ) : (
            <>
              <Tabs defaultValue="signin">
                <TabsList className="grid grid-cols-2 w-full">
                  <TabsTrigger value="signin">Sign in</TabsTrigger>
                  <TabsTrigger value="signup">Sign up</TabsTrigger>
                </TabsList>

                <TabsContent value="signin" className="space-y-3 pt-4">
                  {!showForgot ? (
                    <>
                      <div>
                        <Label>Email</Label>
                        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                      </div>

                      <div>
                        <div className="flex items-center justify-between">
                          <Label>Password</Label>
                          <button
                            type="button"
                            onClick={() => {
                              setResetEmail(email);
                              setShowForgot(true);
                            }}
                            className="text-xs text-muted-foreground underline hover:text-foreground"
                          >
                            Forgot password?
                          </button>
                        </div>
                        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                      </div>

                      <Button className="w-full" disabled={busy} onClick={signIn}>
                        Sign in
                      </Button>
                      <Button variant="outline" className="w-full" onClick={google}>
                        Continue with Google
                      </Button>
                    </>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <Label>Email</Label>
                        <Input type="email" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} />
                      </div>

                      <Button className="w-full" disabled={sendingReset} onClick={sendResetLink}>
                        {sendingReset ? "Sending..." : "Send password reset link"}
                      </Button>

                      <div className="relative py-1 text-center text-xs text-muted-foreground">
                        <div className="absolute inset-x-0 top-1/2 border-t" />
                        <span className="relative bg-card px-2">or, for now</span>
                      </div>

                      <Button variant="outline" className="w-full" disabled={sendingMagic} onClick={sendMagicLink}>
                        {sendingMagic ? "Sending..." : "Email me a one-time sign-in link"}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        The one-time link signs you straight in without a password — a quick way back in if you're
                        locked out right now.
                      </p>

                      <Button variant="ghost" size="sm" className="w-full" onClick={() => setShowForgot(false)}>
                        Back to sign in
                      </Button>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="signup" className="space-y-3 pt-4">
                  <div>
                    <Label>Full name</Label>
                    <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div>
                    <Label>Password</Label>
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                  <div>
                    <Label>I am a…</Label>
                    <RadioGroup
                      value={role}
                      onValueChange={(v) => setRole(v as any)}
                      className="flex flex-wrap gap-4 mt-2"
                    >
                      <label className="flex items-center gap-2 cursor-pointer">
                        <RadioGroupItem value="athlete" /> Athlete
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <RadioGroupItem value="coach" /> Coach
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <RadioGroupItem value="manager" /> Manager
                      </label>
                    </RadioGroup>
                    <p className="text-xs text-muted-foreground mt-1">
                      Manager = team/squad admin with coach-level access to every athlete.
                    </p>
                  </div>
                  <Button className="w-full" disabled={busy} onClick={signUp}>
                    Create account
                  </Button>
                  <Button variant="outline" className="w-full" onClick={google}>
                    Continue with Google
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Google sign-in defaults to the Athlete role — change later in your profile.
                  </p>
                </TabsContent>
              </Tabs>

              <p className="mt-6 text-xs text-center text-muted-foreground">
                <Link to="/" className="underline">
                  Back to home
                </Link>
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
