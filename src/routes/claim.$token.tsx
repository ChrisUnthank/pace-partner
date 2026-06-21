import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/claim/$token")({
  head: () => ({
    meta: [
      { title: "Claim your athlete invite — Strider" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ClaimPage,
});

type InviteInfo = {
  status: "valid" | "claimed" | "expired" | "invalid";
  athlete_name: string | null;
  invited_email: string | null;
  coach_name: string | null;
};

function ClaimPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);

  const { data: invite, isLoading } = useQuery<InviteInfo>({
    queryKey: ["invite", token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_invite_by_token", { _token: token });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? { status: "invalid", athlete_name: null, invited_email: null, coach_name: null }) as InviteInfo;
    },
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSignedInEmail(data.session?.user.email ?? null);
      if (invite?.athlete_name) setFullName((n) => n || invite.athlete_name!);
    });
  }, [invite?.athlete_name]);

  async function finalizeClaim() {
    const { data, error } = await supabase.rpc("claim_athlete_invite", { _token: token });
    if (error) { toast.error(error.message); return false; }
    const res = data as { ok: boolean; error?: string; invited_email?: string };
    if (!res.ok) {
      if (res.error === "email_mismatch") {
        toast.error(`This invite was sent to ${res.invited_email}. Sign in with that email.`);
      } else if (res.error === "claimed") {
        toast.error("This invite was already claimed.");
      } else if (res.error === "expired") {
        toast.error("This invite has expired. Ask your coach for a new one.");
      } else {
        toast.error("Could not claim invite.");
      }
      return false;
    }
    toast.success("You're all set!");
    navigate({ to: "/app" });
    return true;
  }

  async function createAccountAndClaim() {
    if (!invite?.invited_email) return;
    if (password.length < 6) { toast.error("Pick a password (6+ chars)."); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: invite.invited_email,
        password,
        options: { emailRedirectTo: window.location.origin, data: { full_name: fullName || invite.athlete_name || "" } },
      });
      if (error) throw error;
      if (!data.session) {
        toast.success("Check your inbox to confirm your email, then reopen this invite link.");
        return;
      }
      await finalizeClaim();
    } catch (e: any) {
      toast.error(e.message ?? "Sign up failed");
    } finally {
      setBusy(false);
    }
  }

  async function signInAndClaim() {
    if (!invite?.invited_email) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: invite.invited_email,
        password,
      });
      if (error) throw error;
      await finalizeClaim();
    } catch (e: any) {
      toast.error(e.message ?? "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  async function claimAsSignedIn() {
    setBusy(true);
    try { await finalizeClaim(); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Claim your account</CardTitle>
          {isLoading ? (
            <CardDescription>Loading invite…</CardDescription>
          ) : invite?.status === "valid" ? (
            <CardDescription>
              {invite.coach_name ? `${invite.coach_name} invited you` : "You've been invited"} to join Strider as <strong>{invite.athlete_name}</strong>.
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading && <p className="text-sm text-muted-foreground">One moment…</p>}

          {!isLoading && invite?.status === "invalid" && (
            <>
              <p className="text-sm">This invite link isn't valid. Double-check the link your coach sent, or ask them to send a new one.</p>
              <Button asChild variant="outline" className="w-full"><Link to="/">Back to home</Link></Button>
            </>
          )}

          {!isLoading && invite?.status === "claimed" && (
            <>
              <p className="text-sm">This invite has already been claimed. If that was you, just sign in.</p>
              <Button asChild className="w-full"><Link to="/auth">Sign in</Link></Button>
            </>
          )}

          {!isLoading && invite?.status === "expired" && (
            <>
              <p className="text-sm">This invite link has expired (invites are valid for 30 days). Ask your coach to send a fresh one.</p>
              <Button asChild variant="outline" className="w-full"><Link to="/">Back to home</Link></Button>
            </>
          )}

          {!isLoading && invite?.status === "valid" && (
            <>
              {signedInEmail && signedInEmail.toLowerCase() === invite.invited_email?.toLowerCase() ? (
                <>
                  <p className="text-sm">You're signed in as <strong>{signedInEmail}</strong>. Tap below to link this athlete profile to your account.</p>
                  <Button className="w-full" disabled={busy} onClick={claimAsSignedIn}>Accept invite</Button>
                </>
              ) : signedInEmail ? (
                <>
                  <p className="text-sm">
                    You're signed in as <strong>{signedInEmail}</strong>, but this invite was sent to <strong>{invite.invited_email}</strong>.
                    Sign out and try again with that email.
                  </p>
                  <Button variant="outline" className="w-full" onClick={async () => { await supabase.auth.signOut(); setSignedInEmail(null); }}>Sign out</Button>
                </>
              ) : (
                <>
                  <div>
                    <Label>Email</Label>
                    <Input value={invite.invited_email ?? ""} disabled />
                    <p className="mt-1 text-xs text-muted-foreground">Pre-filled from your invite.</p>
                  </div>
                  <div>
                    <Label>Your name</Label>
                    <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={invite.athlete_name ?? ""} />
                  </div>
                  <div>
                    <Label>Password</Label>
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
                  </div>
                  <Button className="w-full" disabled={busy} onClick={createAccountAndClaim}>Create account & accept invite</Button>
                  <div className="text-center text-xs text-muted-foreground">Already have an account?</div>
                  <Button variant="outline" className="w-full" disabled={busy} onClick={signInAndClaim}>Sign in & accept invite</Button>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}