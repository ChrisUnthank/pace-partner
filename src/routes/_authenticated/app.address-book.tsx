import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles, useAuthUser } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { BucketTabStrip, COACHING_HUB_TABS } from "@/components/bucket-tab-strip";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Phone, Mail, MapPin, Users, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/app/address-book")({
  component: AddressBookPage,
});

// ---------------------------------------------------------------------------
// One merged "entry" shape the whole page renders from, regardless of
// whether it came from the roster (athlete), parent links (parent), or a
// manually-added address_book_contacts row (other).
//
// Contact field precedence for athletes/parents:
//   coach overlay  →  person's own self-service details  →  family sharing
// The coach's overlay never overwrites what the person entered in the DB —
// it's a separate private row that simply wins at display time.
// ---------------------------------------------------------------------------
type Entry = {
  key: string;
  kind: "athlete" | "parent" | "other";
  name: string;
  subtitle: string | null;
  photoUrl: string | null;
  email: string | null;
  phone: string | null;
  phoneAlt: string | null;
  address: string | null;
  notes: string | null;
  // Family connections, both directions: an athlete lists their parents,
  // a parent lists their children, a manual contact lists its linked athlete.
  family: { key: string; name: string }[];
  // Ids needed to save the coach overlay / edit the manual row.
  athleteId: string | null;
  parentUserId: string | null;
  manualRowId: string | null;
  roleLabel: string | null;
  organisation: string | null;
  linkedAthleteId: string | null;
  // What the person provided themselves — shown as placeholders in the
  // edit dialog so the coach can see what exists before overriding it.
  selfProvided: { email: string | null; phone: string | null; address: string | null };
};

const KIND_META = {
  athlete: { label: "Athlete", border: "border-l-emerald-500", badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  parent: { label: "Parent / Guardian", border: "border-l-sky-500", badge: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  other: { label: "Contact", border: "border-l-amber-500", badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
} as const;

function AddressBookPage() {
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const isManager = roles.includes("manager");
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "athlete" | "parent" | "other">("all");
  const [editEntry, setEditEntry] = useState<Entry | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // ── Roster athletes ──────────────────────────────────────────────────────
  const { data: rosterAthletes = [] } = useQuery({
    queryKey: ["address-book-roster", user?.id, isManager],
    enabled: !!user && isCoach,
    queryFn: async () => {
      if (isManager) {
        const { data, error } = await supabase
          .from("athletes")
          .select("id, name, profile_image_url, club, primary_event, user_id")
          .order("name");
        if (error) throw error;
        return data ?? [];
      }
      const { data, error } = await supabase
        .from("coach_athletes")
        .select("athlete_id, athletes(id, name, profile_image_url, club, primary_event, user_id)")
        .eq("coach_user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((r: any) => r.athletes).filter(Boolean);
    },
  });

  const athleteIds = rosterAthletes.map((a: any) => a.id);

  // ── Parent links for those athletes ──────────────────────────────────────
  const { data: parentLinks = [] } = useQuery({
    queryKey: ["address-book-parent-links", athleteIds.join(",")],
    enabled: athleteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parent_athlete_links")
        .select("athlete_id, parent_user_id, status")
        .in("athlete_id", athleteIds)
        .eq("status", "active");
      if (error) return [];
      return data ?? [];
    },
  });

  const parentUserIds = [...new Set(parentLinks.map((l: any) => l.parent_user_id))];

  // ── Names/photos for parents ─────────────────────────────────────────────
  const { data: parentProfiles = [] } = useQuery({
    queryKey: ["address-book-parent-profiles", parentUserIds.join(",")],
    enabled: parentUserIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, profile_image_url")
        .in("id", parentUserIds);
      if (error) return [];
      return data ?? [];
    },
  });

  // ── Emails the parents were invited with (fallback identity) ─────────────
  const { data: parentInvites = [] } = useQuery({
    queryKey: ["address-book-parent-invites", athleteIds.join(",")],
    enabled: athleteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parent_invites")
        .select("athlete_id, email, accepted_at")
        .in("athlete_id", athleteIds)
        .not("accepted_at", "is", null);
      if (error) return [];
      return data ?? [];
    },
  });

  // ── Opt-in family contact sharing (from the parent portal build) ─────────
  const { data: familySharing = [] } = useQuery({
    queryKey: ["address-book-family-sharing", athleteIds.join(",")],
    enabled: athleteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("family_contact_sharing")
        .select("athlete_id, email, phone, share_contact")
        .in("athlete_id", athleteIds)
        .eq("share_contact", true);
      if (error) return [];
      return data ?? [];
    },
  });

  // ── Self-service contact details (athletes + parents maintain their own) ─
  const contactUserIds = [
    ...new Set([...rosterAthletes.map((a: any) => a.user_id).filter(Boolean), ...parentUserIds]),
  ];
  const { data: personDetails = [] } = useQuery({
    queryKey: ["address-book-person-details", contactUserIds.join(",")],
    enabled: contactUserIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase.from("person_contact_details" as any) as any)
        .select("user_id, email, phone, phone_alt, address")
        .in("user_id", contactUserIds);
      if (error) return [];
      return data ?? [];
    },
  });

  // ── The coach's own address book rows (overlays + manual contacts) ───────
  const { data: bookRows = [] } = useQuery({
    queryKey: ["address-book-rows", user?.id],
    enabled: !!user && isCoach,
    queryFn: async () => {
      const { data, error } = await (supabase.from("address_book_contacts" as any) as any)
        .select("*")
        .eq("coach_user_id", user!.id);
      if (error) return [];
      return data ?? [];
    },
  });

  // ── Merge everything into display entries ────────────────────────────────
  const entries: Entry[] = useMemo(() => {
    const personByUser = new Map((personDetails as any[]).map((p) => [p.user_id, p]));
    const sharingByAthlete = new Map((familySharing as any[]).map((f) => [f.athlete_id, f]));
    const profileByUser = new Map((parentProfiles as any[]).map((p) => [p.id, p]));
    const athleteById = new Map((rosterAthletes as any[]).map((a) => [a.id, a]));
    const overlayByAthlete = new Map(
      (bookRows as any[]).filter((r) => r.contact_kind === "athlete").map((r) => [r.athlete_id, r]),
    );
    const overlayByParent = new Map(
      (bookRows as any[]).filter((r) => r.contact_kind === "parent").map((r) => [r.parent_user_id, r]),
    );

    const out: Entry[] = [];

    // Athletes
    for (const a of rosterAthletes as any[]) {
      const overlay = overlayByAthlete.get(a.id);
      const self = a.user_id ? personByUser.get(a.user_id) : null;
      const shared = sharingByAthlete.get(a.id);
      const parents = (parentLinks as any[])
        .filter((l) => l.athlete_id === a.id)
        .map((l) => {
          const prof = profileByUser.get(l.parent_user_id);
          return { key: `parent:${l.parent_user_id}`, name: prof?.full_name ?? "Parent / Guardian" };
        });
      out.push({
        key: `athlete:${a.id}`,
        kind: "athlete",
        name: a.name,
        subtitle: [a.primary_event, a.club].filter(Boolean).join(" · ") || null,
        photoUrl: a.profile_image_url ?? null,
        email: overlay?.email ?? self?.email ?? shared?.email ?? null,
        phone: overlay?.phone ?? self?.phone ?? shared?.phone ?? null,
        phoneAlt: overlay?.phone_alt ?? self?.phone_alt ?? null,
        address: overlay?.address ?? self?.address ?? null,
        notes: overlay?.notes ?? null,
        family: parents,
        athleteId: a.id,
        parentUserId: null,
        manualRowId: null,
        roleLabel: null,
        organisation: null,
        linkedAthleteId: null,
        selfProvided: {
          email: self?.email ?? shared?.email ?? null,
          phone: self?.phone ?? shared?.phone ?? null,
          address: self?.address ?? null,
        },
      });
    }

    // Parents — one entry per person, however many children they're linked to
    for (const pid of parentUserIds) {
      const overlay = overlayByParent.get(pid);
      const self = personByUser.get(pid);
      const prof = profileByUser.get(pid);
      const childLinks = (parentLinks as any[]).filter((l) => l.parent_user_id === pid);
      const children = childLinks
        .map((l) => athleteById.get(l.athlete_id))
        .filter(Boolean)
        .map((a: any) => ({ key: `athlete:${a.id}`, name: a.name }));
      // Invite email: any accepted invite for one of this parent's children —
      // best available fallback identity when they haven't filled anything in.
      const inviteEmail =
        (parentInvites as any[]).find((inv) => childLinks.some((l) => l.athlete_id === inv.athlete_id))?.email ?? null;
      out.push({
        key: `parent:${pid}`,
        kind: "parent",
        name: prof?.full_name ?? inviteEmail ?? "Parent / Guardian",
        subtitle: children.length ? `Parent of ${children.map((c) => c.name).join(", ")}` : null,
        photoUrl: prof?.profile_image_url ?? null,
        email: overlay?.email ?? self?.email ?? inviteEmail,
        phone: overlay?.phone ?? self?.phone ?? null,
        phoneAlt: overlay?.phone_alt ?? self?.phone_alt ?? null,
        address: overlay?.address ?? self?.address ?? null,
        notes: overlay?.notes ?? null,
        family: children,
        athleteId: null,
        parentUserId: pid,
        manualRowId: null,
        roleLabel: null,
        organisation: null,
        linkedAthleteId: null,
        selfProvided: { email: self?.email ?? inviteEmail, phone: self?.phone ?? null, address: self?.address ?? null },
      });
    }

    // Manual contacts
    for (const r of (bookRows as any[]).filter((r) => r.contact_kind === "other")) {
      const linked = r.linked_athlete_id ? athleteById.get(r.linked_athlete_id) : null;
      out.push({
        key: `other:${r.id}`,
        kind: "other",
        name: r.name,
        subtitle: [r.role_label, r.organisation].filter(Boolean).join(" · ") || null,
        photoUrl: null,
        email: r.email ?? null,
        phone: r.phone ?? null,
        phoneAlt: r.phone_alt ?? null,
        address: r.address ?? null,
        notes: r.notes ?? null,
        family: linked ? [{ key: `athlete:${linked.id}`, name: linked.name }] : [],
        athleteId: null,
        parentUserId: null,
        manualRowId: r.id,
        roleLabel: r.role_label ?? null,
        organisation: r.organisation ?? null,
        linkedAthleteId: r.linked_athlete_id ?? null,
        selfProvided: { email: null, phone: null, address: null },
      });
    }

    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [rosterAthletes, parentLinks, parentUserIds, parentProfiles, parentInvites, familySharing, personDetails, bookRows]);

  const entryByKey = new Map(entries.map((e) => [e.key, e]));

  const visible = entries.filter((e) => {
    if (filter !== "all" && e.kind !== filter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return [e.name, e.subtitle, e.email, e.phone, e.address, e.organisation]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["address-book-rows"] });
  }

  if (!isCoach) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">The address book is only available to coaches.</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-4 max-w-4xl">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold">Address Book</h1>
            <p className="text-sm text-muted-foreground">
              Athletes and parents populate automatically from your roster — add your own contacts alongside them.
            </p>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add contact
          </Button>
        </div>

        <BucketTabStrip items={COACHING_HUB_TABS} active="/app/address-book" />

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-48">
            <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search names, emails, phones…"
              className="pl-8"
            />
          </div>
          {(["all", "athlete", "parent", "other"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "other" ? "Contacts" : KIND_META[f].label + "s"}
            </Button>
          ))}
        </div>

        {/* Color legend */}
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Athletes</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-500" /> Parents / Guardians</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" /> Other contacts</span>
        </div>

        {visible.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {entries.length === 0 ? "No contacts yet — your roster will appear here." : "No matches."}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {visible.map((e) => (
              <button
                key={e.key}
                onClick={() => setEditEntry(e)}
                className={cn(
                  "w-full text-left border rounded-md border-l-4 px-3 py-2.5 hover:bg-accent/40 transition-colors",
                  KIND_META[e.kind].border,
                )}
              >
                <div className="flex items-start gap-3">
                  <UserAvatar name={e.name} imageUrl={e.photoUrl} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{e.name}</span>
                      <Badge variant="outline" className={cn("text-[10px]", KIND_META[e.kind].badge)}>
                        {e.kind === "other" ? (e.roleLabel ?? "Contact") : KIND_META[e.kind].label}
                      </Badge>
                    </div>
                    {e.subtitle && <div className="text-xs text-muted-foreground truncate">{e.subtitle}</div>}
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                      {e.phone && (
                        <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{e.phone}</span>
                      )}
                      {e.email && (
                        <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{e.email}</span>
                      )}
                      {e.address && (
                        <span className="flex items-center gap-1 truncate max-w-64"><MapPin className="h-3 w-3 shrink-0" />{e.address}</span>
                      )}
                    </div>
                    {e.family.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <Users className="h-3 w-3 text-muted-foreground" />
                        {e.family.map((f) => (
                          <span
                            key={f.key}
                            role="link"
                            tabIndex={0}
                            className="text-[11px] underline decoration-dotted text-muted-foreground hover:text-foreground cursor-pointer"
                            onClick={(ev) => {
                              // Jump to the linked family member's card instead
                              // of opening this row's editor.
                              ev.stopPropagation();
                              const target = entryByKey.get(f.key);
                              if (target) setEditEntry(target);
                            }}
                          >
                            {f.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {editEntry && (
        <ContactDialog
          entry={editEntry}
          coachUserId={user!.id}
          athletes={rosterAthletes as any[]}
          onClose={() => setEditEntry(null)}
          onSaved={() => {
            setEditEntry(null);
            invalidate();
          }}
        />
      )}
      {addOpen && (
        <ContactDialog
          entry={null}
          coachUserId={user!.id}
          athletes={rosterAthletes as any[]}
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            invalidate();
          }}
        />
      )}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Shared dialog: edits the coach overlay for athletes/parents, the full row
// for manual contacts, and creates new manual contacts (entry == null).
// ---------------------------------------------------------------------------
function ContactDialog({
  entry,
  coachUserId,
  athletes,
  onClose,
  onSaved,
}: {
  entry: Entry | null;
  coachUserId: string;
  athletes: any[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isManual = !entry || entry.kind === "other";
  const [name, setName] = useState(entry?.kind === "other" ? entry.name : "");
  const [roleLabel, setRoleLabel] = useState(entry?.roleLabel ?? "");
  const [organisation, setOrganisation] = useState(entry?.organisation ?? "");
  // For athlete/parent overlays the fields start from the currently-displayed
  // merged values so the coach edits what they see; saving writes the overlay
  // row only — the person's own record is never modified from here.
  const [email, setEmail] = useState(entry?.email ?? "");
  const [phone, setPhone] = useState(entry?.phone ?? "");
  const [phoneAlt, setPhoneAlt] = useState(entry?.phoneAlt ?? "");
  const [address, setAddress] = useState(entry?.address ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [linkedAthleteId, setLinkedAthleteId] = useState(entry?.linkedAthleteId ?? "none");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (isManual && !name.trim()) {
      toast.error("A name is required");
      return;
    }
    setSaving(true);
    const tbl = (supabase.from("address_book_contacts" as any) as any);
    try {
      if (!entry) {
        // New manual contact
        const { error } = await tbl.insert({
          coach_user_id: coachUserId,
          contact_kind: "other",
          name: name.trim(),
          role_label: roleLabel || null,
          organisation: organisation || null,
          email: email || null,
          phone: phone || null,
          phone_alt: phoneAlt || null,
          address: address || null,
          notes: notes || null,
          linked_athlete_id: linkedAthleteId === "none" ? null : linkedAthleteId,
        });
        if (error) throw error;
      } else if (entry.kind === "other") {
        const { error } = await tbl
          .update({
            name: name.trim(),
            role_label: roleLabel || null,
            organisation: organisation || null,
            email: email || null,
            phone: phone || null,
            phone_alt: phoneAlt || null,
            address: address || null,
            notes: notes || null,
            linked_athlete_id: linkedAthleteId === "none" ? null : linkedAthleteId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", entry.manualRowId);
        if (error) throw error;
      } else {
        // Coach overlay for an athlete or parent — one row per person, upserted.
        const payload: any = {
          coach_user_id: coachUserId,
          contact_kind: entry.kind,
          athlete_id: entry.athleteId,
          parent_user_id: entry.parentUserId,
          email: email || null,
          phone: phone || null,
          phone_alt: phoneAlt || null,
          address: address || null,
          notes: notes || null,
          updated_at: new Date().toISOString(),
        };
        const { error } = await tbl.upsert(payload, {
          onConflict: entry.kind === "athlete" ? "coach_user_id,athlete_id" : "coach_user_id,parent_user_id",
        });
        if (error) throw error;
      }
      toast.success("Saved");
      onSaved();
    } catch (err: any) {
      toast.error(err?.message ?? "Save failed");
    }
    setSaving(false);
  }

  async function removeManual() {
    if (!entry?.manualRowId) return;
    if (!confirm("Delete this contact?")) return;
    const { error } = await (supabase.from("address_book_contacts" as any) as any)
      .delete()
      .eq("id", entry.manualRowId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Contact deleted");
    onSaved();
  }

  return (
    <Dialog open={true} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {!entry ? "Add contact" : entry.kind === "other" ? "Edit contact" : entry.name}
          </DialogTitle>
          <DialogDescription>
            {!entry || entry.kind === "other"
              ? "A private contact in your address book — another coach, sponsor, supplier, or anyone else."
              : "Details you save here are private to you and shown alongside anything this person has provided themselves."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {isManual && (
            <>
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jane Smith" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Role</Label>
                  <Input value={roleLabel} onChange={(e) => setRoleLabel(e.target.value)} placeholder="Physio, Sponsor…" />
                </div>
                <div className="space-y-1">
                  <Label>Organisation</Label>
                  <Input value={organisation} onChange={(e) => setOrganisation(e.target.value)} placeholder="Company / club" />
                </div>
              </div>
            </>
          )}
          <div className="space-y-1">
            <Label>Email</Label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={entry?.selfProvided.email ?? "email@example.com"}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={entry?.selfProvided.phone ?? "Mobile"}
              />
            </div>
            <div className="space-y-1">
              <Label>Alt. phone</Label>
              <Input value={phoneAlt} onChange={(e) => setPhoneAlt(e.target.value)} placeholder="Home / work" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Address</Label>
            <Textarea
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={entry?.selfProvided.address ?? "Street, town, postcode"}
            />
          </div>
          {isManual && (
            <div className="space-y-1">
              <Label>Linked athlete (optional)</Label>
              <Select value={linkedAthleteId} onValueChange={setLinkedAthleteId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not linked</SelectItem>
                  {athletes.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Private notes" />
          </div>
          <div className="flex items-center justify-between pt-1">
            {entry?.kind === "other" ? (
              <Button variant="destructive" size="sm" onClick={removeManual} disabled={saving}>
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
