import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { todayISO } from "@/lib/format";
import { toast } from "sonner";
import { Trash2, Upload, QrCode, X } from "lucide-react";
import { BucketTabStrip, LOCKER_TABS } from "@/components/bucket-tab-strip";

export const Route = createFileRoute("/_authenticated/app/event-entries")({
  component: EventEntriesPage,
});

const BUCKET = "event-entries";

const STATUS_OPTIONS = [
  { value: "registered", label: "Registered" },
  { value: "confirmed", label: "Confirmed" },
  { value: "waitlisted", label: "Waitlisted" },
  { value: "cancelled", label: "Cancelled" },
];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  registered: "secondary",
  confirmed: "default",
  waitlisted: "outline",
  cancelled: "destructive",
};

function EventEntriesPage() {
  const { data: athlete, isLoading } = useMyAthlete();

  if (isLoading) return <AppShell><p>Loading…</p></AppShell>;
  if (!athlete)
    return (
      <AppShell>
        <p className="text-sm">
          No athlete profile linked. Visit <Link to="/app/profile" className="underline">Profile</Link>.
        </p>
      </AppShell>
    );

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold">Event Entries</h1>
          <p className="text-sm text-muted-foreground">
            Entries, bib numbers, and whatever you need on hand for checkin — including a QR code or confirmation
            screenshot.
          </p>
        </div>
        <BucketTabStrip items={LOCKER_TABS} active="/app/event-entries" />
        <NewEntryForm athleteId={athlete.id} />
        <EntryList athleteId={athlete.id} />
      </div>
    </AppShell>
  );
}

async function uploadAttachment(athleteId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${athleteId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function NewEntryForm({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState<string>("registered");
  const [bibNumber, setBibNumber] = useState("");
  const [confirmationNumber, setConfirmationNumber] = useState("");
  const [checkinNotes, setCheckinNotes] = useState("");
  const [notes, setNotes] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const url = await uploadAttachment(athleteId, file);
      setAttachmentUrl(url);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!eventName.trim()) {
      toast.error("Event name is required");
      return;
    }
    const payload = {
      athlete_id: athleteId,
      event_name: eventName.trim(),
      event_date: eventDate || null,
      location: location || null,
      entry_status: status,
      bib_number: bibNumber || null,
      confirmation_number: confirmationNumber || null,
      checkin_notes: checkinNotes || null,
      notes: notes || null,
      attachment_url: attachmentUrl || null,
    };
    const { error } = await supabase.from("event_entries").insert(payload as any);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Event entry saved");
    setEventName("");
    setEventDate("");
    setLocation("");
    setStatus("registered");
    setBibNumber("");
    setConfirmationNumber("");
    setCheckinNotes("");
    setNotes("");
    setAttachmentUrl("");
    qc.invalidateQueries({ queryKey: ["event-entries", athleteId] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add an entry</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Event name</Label>
            <Input value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="e.g. State Track Championships" />
          </div>
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Location (optional)</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Lakeside Stadium" />
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Bib / race number</Label>
            <Input value={bibNumber} onChange={(e) => setBibNumber(e.target.value)} placeholder="e.g. 482" />
          </div>
          <div>
            <Label className="text-xs">Confirmation number</Label>
            <Input
              value={confirmationNumber}
              onChange={(e) => setConfirmationNumber(e.target.value)}
              placeholder="e.g. ABC123456"
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">Checkin notes</Label>
          <Textarea
            placeholder="e.g. gates open 7am, bib collection at the merch tent"
            value={checkinNotes}
            onChange={(e) => setCheckinNotes(e.target.value)}
          />
        </div>
        <Textarea placeholder="Other notes" value={notes} onChange={(e) => setNotes(e.target.value)} />

        <div>
          <Label className="text-xs">QR code / confirmation screenshot (optional)</Label>
          {attachmentUrl ? (
            <div className="relative w-32 mt-1.5">
              <img src={attachmentUrl} alt="Attachment" className="rounded-md border border-border w-full" />
              <button
                type="button"
                onClick={() => setAttachmentUrl("")}
                className="absolute -right-2 -top-2 rounded-full bg-background border border-border p-0.5"
                aria-label="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div className="mt-1.5">
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
              >
                <Upload className="h-3.5 w-3.5 mr-1" /> {uploading ? "Uploading…" : "Upload image"}
              </Button>
            </div>
          )}
        </div>

        <Button onClick={save} className="w-full">
          Save entry
        </Button>
      </CardContent>
    </Card>
  );
}

function EntryList({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const { data: entries } = useQuery({
    queryKey: ["event-entries", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_entries")
        .select("*")
        .eq("athlete_id", athleteId)
        .order("event_date", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  async function remove(id: string) {
    const { error } = await supabase.from("event_entries").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["event-entries", athleteId] });
  }

  if (!entries || entries.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground text-center">No event entries logged yet.</CardContent>
      </Card>
    );
  }

  const today = todayISO();
  const upcoming = entries.filter((e) => !e.event_date || e.event_date >= today);
  const past = entries.filter((e) => e.event_date && e.event_date < today);

  return (
    <div className="space-y-4">
      {upcoming.map((e) => (
        <EntryCard key={e.id} entry={e} onDelete={() => remove(e.id)} />
      ))}
      {past.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-4">Past</div>
          <div className="space-y-2">
            {past.map((e) => (
              <EntryCard key={e.id} entry={e} onDelete={() => remove(e.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EntryCard({ entry, onDelete }: { entry: any; onDelete: () => void }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base">{entry.event_name}</CardTitle>
            <CardDescription>
              {entry.event_date &&
                new Date(entry.event_date + "T00:00:00").toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              {entry.location && ` · ${entry.location}`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {entry.entry_status && (
              <Badge variant={STATUS_VARIANT[entry.entry_status] ?? "secondary"} className="capitalize">
                {entry.entry_status}
              </Badge>
            )}
            <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete">
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {entry.bib_number && <span>Bib {entry.bib_number}</span>}
          {entry.confirmation_number && <span>Conf. {entry.confirmation_number}</span>}
        </div>
        {entry.checkin_notes && (
          <div className="flex items-start gap-1.5">
            <QrCode className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs">{entry.checkin_notes}</p>
          </div>
        )}
        {entry.notes && <p className="text-xs text-muted-foreground">{entry.notes}</p>}
        {entry.attachment_url && (
          <a href={entry.attachment_url} target="_blank" rel="noreferrer">
            <img src={entry.attachment_url} alt="Attachment" className="rounded-md border border-border w-24 mt-1" />
          </a>
        )}
      </CardContent>
    </Card>
  );
}
