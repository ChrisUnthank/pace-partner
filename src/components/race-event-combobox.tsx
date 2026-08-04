import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "sonner";
import { ChevronsUpDown, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export type RaceEventOption = {
  id: string;
  name: string;
  event_date: string | null;
};

/**
 * Links a performance to a shared race_events row — the foundation for the
 * multi-athlete "same race, several athletes" view (Race Events page).
 * Unlike CourseCombobox (which just reuses free-text values already on
 * this athlete's own rows), this is a real shared table: several
 * different athletes' performances need to point at the exact same row,
 * so free-text matching would silently split one real race into two
 * ("5000m Champs" vs "5000m Championships") — this always resolves to a
 * real id, creating a new race_events row inline only when nothing
 * existing matches.
 */
export function RaceEventCombobox({
  value,
  onChange,
  defaultDate,
  defaultDistanceM,
  defaultRaceType,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  // Seed values for a newly-created event only — never applied to an
  // existing one the user picks.
  defaultDate?: string | null;
  defaultDistanceM?: number | null;
  defaultRaceType?: string | null;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  // RLS already scopes this to events the user created or already has a
  // linked, visible performance on — no separate athlete/roster filter
  // needed here.
  const { data: events } = useQuery({
    queryKey: ["race-events-picker"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("race_events")
        .select("id, name, event_date")
        .order("event_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as RaceEventOption[];
    },
  });

  // The full picker list above only loads once the popover is opened
  // (enabled: open) — without this, a dialog that opens already linked to
  // an event would show "None" in the trigger button until the user
  // clicked it at least once. Fetches just the one selected row eagerly.
  const { data: selectedEvent } = useQuery({
    queryKey: ["race-event-selected", value],
    enabled: !!value,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("race_events")
        .select("id, name, event_date")
        .eq("id", value)
        .maybeSingle();
      if (error) throw error;
      return data as RaceEventOption | null;
    },
  });

  const selected = useMemo(
    () => (events ?? []).find((e) => e.id === value) ?? (value ? selectedEvent ?? null : null),
    [events, value, selectedEvent],
  );

  async function createAndSelect(name: string) {
    setCreating(true);
    const { data, error } = await (supabase as any)
      .from("race_events")
      .insert({
        name,
        event_date: defaultDate || null,
        distance_m: defaultDistanceM || null,
        race_type: defaultRaceType || null,
      })
      .select("id, name, event_date")
      .single();
    setCreating(false);
    if (error || !data) {
      toast.error(error?.message ?? "Couldn't create race event");
      return;
    }
    qc.invalidateQueries({ queryKey: ["race-events-picker"] });
    qc.invalidateQueries({ queryKey: ["race-events-list"] });
    onChange(data.id);
    setQuery("");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate flex items-center gap-1.5", !selected && "text-muted-foreground")}>
            {selected && <Users className="h-3.5 w-3.5 shrink-0" />}
            {selected ? selected.name : "None (not tied to a shared event)"}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search or name a race event…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>
              {query.trim() ? (
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-sm disabled:opacity-50"
                  disabled={creating}
                  onClick={() => createAndSelect(query.trim())}
                >
                  {creating ? "Creating…" : `Create shared event "${query.trim()}"`}
                </button>
              ) : (
                <div className="px-3 py-2 text-sm text-muted-foreground">No race events yet — type a name to create one.</div>
              )}
            </CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onChange(null);
                    setQuery("");
                    setOpen(false);
                  }}
                  className="text-muted-foreground"
                >
                  None (not tied to a shared event)
                </CommandItem>
              )}
              {(events ?? [])
                .filter((e) => !value || e.id !== value)
                .map((e) => (
                  <CommandItem
                    key={e.id}
                    value={`${e.name} ${e.event_date ?? ""}`}
                    onSelect={() => {
                      onChange(e.id);
                      setQuery("");
                      setOpen(false);
                    }}
                  >
                    <span className="truncate">{e.name}</span>
                    {e.event_date && <span className="text-xs text-muted-foreground ml-2 shrink-0">{e.event_date}</span>}
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
