import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyAthlete } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { IdCard } from "lucide-react";
import { BucketTabStrip, LOCKER_TABS } from "@/components/bucket-tab-strip";

export const Route = createFileRoute("/_authenticated/app/credentials")({
  component: CredentialsPage,
});

function CredentialsPage() {
  const { data: athlete, isLoading } = useMyAthlete();

  if (isLoading) return <AppShell fullWidth><p>Loading…</p></AppShell>;
  if (!athlete)
    return (
      <AppShell fullWidth>
        <p className="text-sm">
          No athlete profile linked. Visit <Link to="/app/profile" className="underline">Profile</Link>.
        </p>
      </AppShell>
    );

  return (
    <AppShell fullWidth>
      <div className="space-y-6 max-w-2xl">
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
            style={{ background: "var(--accent-red)" }}
          >
            <IdCard className="h-5 w-5 text-white" strokeWidth={2} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Locker</div>
            <h1 className="text-2xl font-bold leading-tight">Credentials</h1>
            <p className="text-sm text-muted-foreground">
              Club, membership, and registration details — handy to have on hand for race-day admin.
            </p>
          </div>
        </div>
        <BucketTabStrip items={LOCKER_TABS} active="/app/credentials" />
        <CredentialsForm athleteId={athlete.id} />
      </div>
    </AppShell>
  );
}

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
  { value: "pending", label: "Pending" },
];

function CredentialsForm({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["athlete-credentials", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_credentials")
        .select("*")
        .eq("athlete_id", athleteId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const [club, setClub] = useState("");
  const [membershipNumber, setMembershipNumber] = useState("");
  const [federationId, setFederationId] = useState("");
  const [status, setStatus] = useState<string>("none");
  const [expiry, setExpiry] = useState("");
  const [notes, setNotes] = useState("");

  // Re-sync once the record loads (or reloads after a save) — same
  // pattern used throughout this build for forms backed by a single
  // fetched row.
  useEffect(() => {
    setClub(data?.club_name ?? "");
    setMembershipNumber(data?.membership_number ?? "");
    setFederationId(data?.federation_id ?? "");
    setStatus(data?.registration_status ?? "none");
    setExpiry(data?.registration_expiry ?? "");
    setNotes(data?.notes ?? "");
  }, [data]);

  async function save() {
    const payload = {
      athlete_id: athleteId,
      club_name: club || null,
      membership_number: membershipNumber || null,
      federation_id: federationId || null,
      registration_status: status === "none" ? null : status,
      registration_expiry: expiry || null,
      notes: notes || null,
    };
    const { error } = await supabase
      .from("athlete_credentials")
      .upsert(payload as any, { onConflict: "athlete_id" });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Credentials saved");
    qc.invalidateQueries({ queryKey: ["athlete-credentials", athleteId] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IdCard className="h-4 w-4 text-muted-foreground" /> Membership & registration
        </CardTitle>
        <CardDescription>One record, editable any time — not a log.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Club</Label>
            <Input value={club} onChange={(e) => setClub(e.target.value)} placeholder="e.g. Melbourne Harriers" />
          </div>
          <div>
            <Label className="text-xs">Membership number</Label>
            <Input
              value={membershipNumber}
              onChange={(e) => setMembershipNumber(e.target.value)}
              placeholder="e.g. 123456"
            />
          </div>
          <div>
            <Label className="text-xs">Federation ID (e.g. Athletics Australia number)</Label>
            <Input value={federationId} onChange={(e) => setFederationId(e.target.value)} placeholder="e.g. AA1234567" />
          </div>
          <div>
            <Label className="text-xs">Registration status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Registration expiry (optional)</Label>
            <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </div>
        </div>
        <Textarea
          placeholder="Notes — anything else worth having on record"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <Button onClick={save} className="w-full">
          Save credentials
        </Button>
      </CardContent>
    </Card>
  );
}
