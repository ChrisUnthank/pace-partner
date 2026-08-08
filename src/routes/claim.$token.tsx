import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/claim/$token")({
  head: () => ({
    meta: [
      { title: "Claim your invite — Strider" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ClaimPage,
});

// Two invite kinds now share this one claim page — an athlete invite
// (claim_athlete_invite, links the athlete record itself to the signed-in
// user) and a parent invite (claim_parent_invite, adds a
// parent_athlete_links row + the 'parent' role instead, without touching
// the athlete record at all). get_invite_by_token now checks both
// athlete_invites and parent_invites and reports which one this token
// belongs to via `kind`. Previously this page only ever knew about
// athlete_invites — every parent invite ever sent landed on "This invite
// link isn't valid" with no indication why.
type InviteKind = "athlete" | "parent";

type InviteInfo = {
  status: "valid" | "claimed" | "expired" | "invalid";
  kind: InviteKind | null;
  athlete_name: string | null;
  invited_email: string | null;
  coach_name: string | null;
};

// Bump this whenever the consent wording below meaningfully changes — it
// gets stored alongside each consent record, so a parent's actual
// agreement can always be traced back to the exact text they saw, even
// after the wording is later updated.
const PARENT_CONSENT_TEXT_VERSION = "v1-2026-08";

function ClaimPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);

  const { data: invite, isLoading } = useQuery<InviteInfo>({
    queryKey: ["invite", token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_invite_by_token", { _token: token });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? {
        status: "invalid",
        kind: null,
        athlete_name: null,
        invited_email: null,
        coach_name: null,
      }) as InviteInfo;
    },
  });

  const isParentInvite = invite?.kind === "parent";

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSignedInEmail(data.session?.user.email ?? null);
      // Only pre-fill the "your name" field for an athlete invite — the
      // athlete's own name makes sense as a default there. A parent
      // invite's fullName field is the PARENT's name, which has nothing
      // to do with the athlete_name on the invite.
      if (invite?.athlete_name && invite.kind === "athlete") setFullName((n) => n || invite.athlete_name!);
    });
  }, [invite?.athlete_name, invite?.kind]);

  async function finalizeClaim() {
    if (isParentInvite) {
      const { data: sessionData } = await supabase.auth.getUser();
      const parentUserId = sessionData.user?.id;
      if (!parentUserId) {
        toast.error("Couldn't confirm your account — try signing in again.");
        return false;
      }
      const { error: consentErr } = await supabase.from("parent_consent_records").insert({
        invite_token: token,
        parent_user_id: parentUserId,
        consent_text_version: PARENT_CONSENT_TEXT_VERSION,
      });
      if (consentErr) {
        toast.error("Couldn't record consent — please try again.");
        return false;
      }
    }
    const rpcName = isParentInvite ? "claim_parent_invite" : "claim_athlete_invite";
    const { data, error } = await supabase.rpc(rpcName, { _token: token });
    if (error) { toast.error(error.message); return false; }
    const res = data as { ok: boolean; error?: string; invited_email?: string };
    if (!res.ok) {
      if (res.error === "email_mismatch") {
        toast.error(`This invite was sent to ${res.invited_email}. Sign in with that email.`);
      } else if (res.error === "claimed") {
        toast.error("This invite was already claimed.");
      } else if (res.error === "expired") {
        toast.error("This invite has expired. Ask them to send a new one.");
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
          <CardTitle className="text-2xl">Claim your invite</CardTitle>
          {isLoading ? (
            <CardDescription>Loading invite…</CardDescription>
          ) : invite?.status === "valid" && isParentInvite ? (
            <CardDescription>
              {invite.coach_name ? `${invite.coach_name} invited you` : "You've been invited"} to follow{" "}
              <strong>{invite.athlete_name}</strong>'s training as a parent/guardian.
            </CardDescription>
          ) : invite?.status === "valid" ? (
            <CardDescription>
              {invite.coach_name ? `${invite.coach_name} invited you` : "You've been invited"} to join Strider as{" "}
              <strong>{invite.athlete_name}</strong>.
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading && <p className="text-sm text-muted-foreground">One moment…</p>}

          {!isLoading && invite?.status === "invalid" && (
            <>
              <p className="text-sm">This invite link isn't valid. Double-check the link you were sent, or ask for a new one.</p>
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
              <p className="text-sm">This invite link has expired (invites are valid for 30 days). Ask for a fresh one.</p>
              <Button asChild variant="outline" className="w-full"><Link to="/">Back to home</Link></Button>
            </>
          )}

          {!isLoading && invite?.status === "valid" && (
            <>
              {isParentInvite && (
                <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                  <Checkbox
                    id="parent-consent"
                    checked={consentChecked}
                    onCheckedChange={(v) => setConsentChecked(!!v)}
                    className="mt-0.5"
                  />
                  <label htmlFor="parent-consent" className="text-xs leading-relaxed cursor-pointer">
                    I confirm I am the parent or legal guardian of <strong>{invite.athlete_name}</strong>, and I
                    consent to their training data (sessions, performance metrics, and check-ins) being collected
                    and processed within Strider{invite.coach_name ? ` by ${invite.coach_name}` : ""}.
                  </label>
                </div>
              )}
              {signedInEmail && signedInEmail.toLowerCase() === invite.invited_email?.toLowerCase() ? (
                <>
                  <p className="text-sm">
                    You're signed in as <strong>{signedInEmail}</strong>. Tap below to{" "}
                    {isParentInvite ? (
                      <>link <strong>{invite.athlete_name}</strong> to your account as a parent/guardian</>
                    ) : (
                      <>link this athlete profile to your account</>
                    )}
                    . This adds to your account — it won't remove any roles or links you already have.
                  </p>
                  <Button className="w-full" disabled={busy || (isParentInvite && !consentChecked)} onClick={claimAsSignedIn}>
                    Accept invite
                  </Button>
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
                    <Input
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder={isParentInvite ? "Your name" : invite.athlete_name ?? ""}
                    />
                  </div>
                  <div>
                    <Label>Password</Label>
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
                  </div>
                  <Button
                    className="w-full"
                    disabled={busy || (isParentInvite && !consentChecked)}
                    onClick={createAccountAndClaim}
                  >
                    Create account & accept invite
                  </Button>
                  <div className="text-center text-xs text-muted-foreground">Already have an account?</div>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={busy || (isParentInvite && !consentChecked)}
                    onClick={signInAndClaim}
                  >
                    Sign in & accept invite
                  </Button>
                  {isParentInvite && (
                    <p className="text-xs text-muted-foreground text-center">
                      Already coach or athlete on Strider? Sign in above with that same account instead of creating a
                      new one — this invite just adds to it.
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
