import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { useAuthUser } from "@/lib/use-auth";

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
    if (!locationText.trim()) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("training_locations")
      .insert({ name: locationText.trim(), created_by: user?.id ?? null })
      .select("id, name, address")
      .single();
    setSaving(false);
    if (error || !data) {
      toast.error(error?.message ?? "Couldn't save this location");
      return;
    }
    toast.success(`Saved "${data.name}" as a location`);
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
