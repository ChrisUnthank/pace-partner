import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Switch } from "@/components/ui/switch";
import { clockToSec, secToClock } from "@/lib/format";
import { toast } from "sonner";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { RaceEventCombobox } from "@/components/race-event-combobox";

const COMMON_DISTANCES = [
  { m: 800, label: "800m" },
  { m: 1500, label: "1500m" },
  { m: 1609, label: "Mile" },
  { m: 3000, label: "3000m" },
  { m: 5000, label: "5000m" },
  { m: 10000, label: "10K" },
  { m: 21097, label: "Half marathon" },
  { m: 42195, label: "Marathon" },
];

export type EditablePerformance = {
  id: string;
  athlete_id: string;
  performance_date: string;
  distance_m: number;
  time_seconds: number;
  event_name?: string | null;
  race_type?: string | null;
  overall_place?: number | null;
  notes?: string | null;
  course_name?: string | null;
  excluded_from_pb?: boolean | null;
  race_event_id?: string | null;
};

// Combobox for course_name — autocomplete from this athlete's previously
// used courses (via CommandInput's search-as-you-type filtering), but
// still lets a brand-new course be typed and used since there's no
// courses table backing this, just distinct values already on this
// athlete's rows.
function CourseCombobox({
  value,
  onChange,
  courses,
}: {
  value: string;
  onChange: (v: string) => void;
  courses: string[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);

  useEffect(() => {
    setQuery(value);
  }, [value]);

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
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value || "None (not tied to a course)"}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search or type a course…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>
              {query.trim() ? (
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-sm"
                  onClick={() => {
                    onChange(query.trim());
                    setOpen(false);
                  }}
                >
                  Use "{query.trim()}"
                </button>
              ) : (
                <div className="px-3 py-2 text-sm text-muted-foreground">No courses yet — type to add one.</div>
              )}
            </CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onChange("");
                    setQuery("");
                    setOpen(false);
                  }}
                  className="text-muted-foreground"
                >
                  None (not tied to a course)
                </CommandItem>
              )}
              {courses.map((c) => (
                <CommandItem
                  key={c}
                  value={c}
                  onSelect={() => {
                    onChange(c);
                    setQuery(c);
                    setOpen(false);
                  }}
                >
                  {c}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Shared "fix an existing result" dialog — Races page and Profile's PBs
// card both had an add-a-result form already (left untouched here) but
// no way to correct a result once saved, especially anything with no
// linked session (bulk-imported or manually entered rows), which had
// literally no update path in the app at all. This covers every field
// that actually varies between the two pages' add-forms — editing a
// result created from a session should still go through that session's
// own page, not here.
//
// Deliberately does NOT touch is_pb/is_year_best/is_season_best/
// is_course_best — the DB trigger (recompute_pb_after_perf_change)
// recalculates all four automatically the instant distance_m/
// time_seconds/race_type/course_name/excluded_from_pb changes.
export function PerformanceEditDialog({
  open,
  onOpenChange,
  performance,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  performance: EditablePerformance | null;
  onSaved: () => void;
}) {
  const [date, setDate] = useState("");
  const [distanceMode, setDistanceMode] = useState<"preset" | "custom">("preset");
  const [distance, setDistance] = useState(5000);
  const [customDistance, setCustomDistance] = useState("");
  const [time, setTime] = useState("");
  const [event, setEvent] = useState("");
  const [raceType, setRaceType] = useState("road");
  const [placing, setPlacing] = useState("");
  const [notes, setNotes] = useState("");
  const [courseName, setCourseName] = useState("");
  const [excludedFromPb, setExcludedFromPb] = useState(false);
  const [raceEventId, setRaceEventId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Courses already used by this athlete, for the combobox — refetched
  // whenever the dialog opens for a (potentially different) athlete.
  const { data: courses } = useQuery({
    queryKey: ["athlete-courses", performance?.athlete_id],
    enabled: open && !!performance?.athlete_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("performances")
        .select("course_name")
        .eq("athlete_id", performance!.athlete_id)
        .not("course_name", "is", null);
      const names = new Set((data ?? []).map((r: any) => r.course_name as string).filter(Boolean));
      return Array.from(names).sort();
    },
  });

  // Dialog stays mounted between opens, so the form has to be re-seeded
  // from whichever row was clicked each time it opens, rather than
  // relying on fresh initial state.
  useEffect(() => {
    if (!open || !performance) return;

    const isPreset = COMMON_DISTANCES.some((d) => d.m === performance.distance_m);
    setDate(performance.performance_date);
    setDistanceMode(isPreset ? "preset" : "custom");
    setDistance(isPreset ? performance.distance_m : 5000);
    setCustomDistance(isPreset ? "" : String(performance.distance_m));
    setTime(secToClock(performance.time_seconds));
    setEvent(performance.event_name ?? "");
    setRaceType(performance.race_type ?? "road");
    setPlacing(performance.overall_place != null ? String(performance.overall_place) : "");
    setNotes(performance.notes ?? "");
    setCourseName(performance.course_name ?? "");
    setExcludedFromPb(!!performance.excluded_from_pb);
    setRaceEventId(performance.race_event_id ?? null);
  }, [open, performance]);

  async function save() {
    if (!performance) return;

    const sec = clockToSec(time);
    if (!date || sec == null || Number.isNaN(sec)) {
      toast.error("Date and time required");
      return;
    }

    const finalDistance = distanceMode === "custom" ? Number(customDistance) : distance;
    if (!finalDistance || Number.isNaN(finalDistance) || finalDistance <= 0) {
      toast.error("Enter a valid distance in meters");
      return;
    }

    setSaving(true);

    const { error } = await supabase
      .from("performances")
      .update({
        performance_date: date,
        distance_m: finalDistance,
        time_seconds: sec,
        event_name: event || null,
        race_type: raceType || null,
        overall_place: placing ? Number(placing) : null,
        notes: notes || null,
        course_name: courseName || null,
        excluded_from_pb: excludedFromPb,
        race_event_id: raceEventId,
      })
      .eq("id", performance.id);

    setSaving(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Result updated");
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit result</DialogTitle>
          <DialogDescription>
            PB status recalculates automatically once you save — no need to touch anything else.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Distance</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={distanceMode === "preset" ? "default" : "outline"}
                onClick={() => setDistanceMode("preset")}
              >
                Preset
              </Button>
              <Button
                type="button"
                size="sm"
                variant={distanceMode === "custom" ? "default" : "outline"}
                onClick={() => setDistanceMode("custom")}
              >
                Custom
              </Button>
            </div>
            {distanceMode === "preset" ? (
              <Select value={String(distance)} onValueChange={(v) => setDistance(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_DISTANCES.map((d) => (
                    <SelectItem key={d.m} value={String(d.m)}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                type="number"
                placeholder="e.g. 7400"
                value={customDistance}
                onChange={(e) => setCustomDistance(e.target.value)}
              />
            )}
          </div>

          <div>
            <Label className="text-xs">Surface</Label>
            <Select value={raceType} onValueChange={setRaceType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="track">Track</SelectItem>
                <SelectItem value="road">Road</SelectItem>
                <SelectItem value="cross_country">Cross country</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Time</Label>
            <Input placeholder="16:32" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>

          <div>
            <Label className="text-xs">Event name</Label>
            <Input value={event} onChange={(e) => setEvent(e.target.value)} placeholder="London Champs 5000m" />
          </div>

          <div>
            <Label className="text-xs">Course</Label>
            <CourseCombobox value={courseName} onChange={setCourseName} courses={courses ?? []} />
            <p className="text-xs text-muted-foreground mt-1">
              Optional — set this to track a Course Best, separate from distance-based PBs. Useful for cross country,
              where the same "course" rarely measures exactly the same distance race to race.
            </p>
          </div>

          <div>
            <Label className="text-xs">Race event</Label>
            <RaceEventCombobox
              value={raceEventId}
              onChange={setRaceEventId}
              defaultDate={date}
              defaultDistanceM={distanceMode === "custom" ? Number(customDistance) : distance}
              defaultRaceType={raceType}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Optional — link this result to a shared race event so it shows up alongside any other athletes you
              coach who ran the same race. Create a new one, or pick an existing one if you've already linked another
              athlete's result to it.
            </p>
          </div>

          <div>
            <Label className="text-xs">Placing</Label>
            <Input type="number" value={placing} onChange={(e) => setPlacing(e.target.value)} placeholder="Optional" />
          </div>

          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <Label className="text-xs">Exclude from PB calculations</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                For odd/one-off distances (e.g. a cross country course) that shouldn't compete against standard
                track/road times for PB, Season Best, or Year Best. Course Best still applies if a course is set
                above.
              </p>
            </div>
            <Switch checked={excludedFromPb} onCheckedChange={setExcludedFromPb} className="shrink-0 ml-3" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
