import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { useAuthUser, useMyRoles, useMyAthlete } from "@/lib/use-auth";

// Same shared, coach-managed pool sessions/squad_training_sessions
// already link to via location_id — reusing it here (rather than a
// separate location concept for races) is what makes "linking a location
// to a race" actually mean something: a saved location can carry real
// lat/lng, so a race that links to one gets a location that can show up
// on a map or get reused consistently at the same venue, not just a
// repeated string.
type SavedLocation = { id: string; name: string; address: string | null };

export function LocationPicker({
  locationId,
  locationText,
  onChange,
  compact = false,
}: {
  locationId: string | null;
  locationText: string;
  onChange: (patch: { locationId: string | null; locationText: string }) => void;
  compact?: boolean;
}) {
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const { data: myAthlete } = useMyAthlete();
  const isCoach = roles.includes("coach");
  const qc = useQueryClient();
  const [mode, setMode] = useState<"saved" | "custom" | "none">(locationId ? "saved" : locationText ? "custom" : "none");
  const [saving, setSaving] = useState(false);

  // Re-sync if the parent resets this row's value out from under us (e.g.
  // an import-preview row getting reset) — cheap, only fires on identity
  // changes to the controlled values, not every render.
  useEffect(() => {
    setMode(locationId ? "saved" : locationText ? "custom" : "none");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  const { data: savedLocations } = useQuery({
    queryKey: ["training-locations-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("training_locations").select("id, name, address").order("name");
      if (error) throw error;
      return (data ?? []) as SavedLocation[];
    },
  });

  async function saveAsLocation() {
    const trimmed = locationText.trim();
    if (!trimmed) return;

    // Reuse an existing location of the same name instead of creating a
    // second one. Working down an import preview and hitting "save" on each
    // row is exactly how four venues ended up in the table twice, eight
    // minutes apart — the button had no idea they already existed.
    //
    // Case-insensitive because "The Tan" and "the tan" are the same place.
    const existing = (savedLocations ?? []).find(
      (l) => l.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) {
      toast.success(`Using the existing "${existing.name}"`);
      setMode("saved");
      onChange({ locationId: existing.id, locationText: "" });
      return;
    }

    setSaving(true);

    // Ownership, matching the Maps page editor exactly: a coach creates a
    // SQUAD location (owner_athlete_id null, visible to all, coach-editable);
    // an athlete creates one PERSONAL to them.
    //
    // This was previously omitted, so an athlete saving a venue here created
    // a squad row they then couldn't edit — the same "I added it but can't
    // change it" symptom, from a different cause than the missing UPDATE
    // policy.
    const ownerAthleteId = !isCoach && myAthlete?.id ? myAthlete.id : null;

    const { data, error } = await (supabase as any)
      .from("training_locations")
      .insert({
        name: trimmed,
        created_by: user?.id ?? null,
        owner_athlete_id: ownerAthleteId,
      })
      .select("id, name, address")
      .single();
    setSaving(false);
    if (error || !data) {
      toast.error(error?.message ?? "Couldn't save this location");
      return;
    }

    // Deliberately says the location has no coordinates. This shortcut only
    // captures a NAME — no lat/lng — and a location without coordinates can
    // never auto-match a session on import, because matching compares the
    // session's start point against the location's pin and there's nothing
    // to compare against. It's still perfectly usable when picked by hand;
    // it just silently never attaches itself, which is worth saying once
    // rather than leaving to be discovered months later.
    toast.success(`Saved "${data.name}" — add a pin on the Maps page so sessions here match automatically`);
    qc.invalidateQueries({ queryKey: ["training-locations-list"] });
    setMode("saved");
    onChange({ locationId: data.id, locationText: "" });
  }

  const sizeCls = compact ? "h-8 text-xs" : "";

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <Button
          type="button"
          size="sm"
          variant={mode === "saved" ? "default" : "outline"}
          className={compact ? "h-7 px-2 text-xs" : ""}
          onClick={() => {
            setMode("saved");
            onChange({ locationId: locationId ?? savedLocations?.[0]?.id ?? null, locationText: "" });
          }}
        >
          Saved
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "custom" ? "default" : "outline"}
          className={compact ? "h-7 px-2 text-xs" : ""}
          onClick={() => {
            setMode("custom");
            onChange({ locationId: null, locationText });
          }}
        >
          Custom text
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "none" ? "default" : "outline"}
          className={compact ? "h-7 px-2 text-xs" : ""}
          onClick={() => {
            setMode("none");
            onChange({ locationId: null, locationText: "" });
          }}
        >
          None
        </Button>
      </div>

      {mode === "saved" && (
        <Select value={locationId ?? ""} onValueChange={(v) => onChange({ locationId: v, locationText: "" })}>
          <SelectTrigger className={sizeCls}>
            <SelectValue placeholder="Pick a saved location" />
          </SelectTrigger>
          <SelectContent>
            {(savedLocations ?? []).length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">No saved locations yet — use Custom text to add one.</div>
            ) : (
              (savedLocations ?? []).map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                  {l.address ? ` — ${l.address}` : ""}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      )}

      {mode === "custom" && (
        <div className="flex gap-1.5">
          <Input
            value={locationText}
            onChange={(e) => onChange({ locationId: null, locationText: e.target.value })}
            placeholder="e.g. Melbourne Athletics Track"
            className={sizeCls}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={compact ? "h-8 px-2 shrink-0" : "shrink-0"}
            disabled={!locationText.trim() || saving}
            onClick={saveAsLocation}
            title="Save this as a reusable location"
          >
            <Save className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
