import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

/**
 * Self-service contact details — the "self" half of the address book design.
 * Any signed-in user (athlete or parent) maintains their own phone / email /
 * address here; coaches read it into the Coaching Hub address book. Writes
 * to person_contact_details, which is RLS'd so only the person themselves
 * can edit their row.
 */
export function ContactDetailsCard({ userId }: { userId: string }) {
  const qc = useQueryClient();

  const { data: existing, isLoading } = useQuery({
    queryKey: ["my-contact-details", userId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("person_contact_details" as any) as any)
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) return null;
      return data;
    },
  });

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneAlt, setPhoneAlt] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Populate the form once when the row arrives — not on every refetch,
  // which would clobber in-progress edits.
  useEffect(() => {
    if (isLoading || loaded) return;
    setEmail(existing?.email ?? "");
    setPhone(existing?.phone ?? "");
    setPhoneAlt(existing?.phone_alt ?? "");
    setAddress(existing?.address ?? "");
    setLoaded(true);
  }, [isLoading, loaded, existing]);

  async function save() {
    setSaving(true);
    const { error } = await (supabase.from("person_contact_details" as any) as any).upsert({
      user_id: userId,
      email: email || null,
      phone: phone || null,
      phone_alt: phoneAlt || null,
      address: address || null,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Contact details saved");
      qc.invalidateQueries({ queryKey: ["my-contact-details", userId] });
    }
    setSaving(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contact details</CardTitle>
        <CardDescription>
          Shared with your coach for the squad address book — how you can be reached off the track.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label>Email</Label>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile" />
          </div>
          <div className="space-y-1">
            <Label>Alt. phone</Label>
            <Input value={phoneAlt} onChange={(e) => setPhoneAlt(e.target.value)} placeholder="Home / work" />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Address</Label>
          <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, town, postcode" />
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={saving || isLoading}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
