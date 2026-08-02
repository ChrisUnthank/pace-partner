import { UserAvatar } from "@/components/user-avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type PickerAthlete = { id: string; name: string; profile_image_url?: string | null };

// Shared coach athlete-switcher — avatar circle + dropdown, matching the
// pattern Calendar already had inline. Deliberately generic about how the
// selection is stored: some pages keep it in a URL search param (via
// navigate), others in local state — the caller decides via onChange,
// this component just renders and reports a choice.
//
// Calendar itself isn't refactored to use this yet (already working,
// left alone) — new call sites (Health, Analytics, and others as they
// come up) should use this instead of re-copying the inline version.
export function CoachAthletePicker({
  roster,
  myAthlete,
  value,
  onChange,
  allowAll,
  allLabel = "All athletes",
}: {
  roster: PickerAthlete[];
  myAthlete?: PickerAthlete | null;
  value: string | undefined;
  onChange: (athleteId: string) => void;
  // Adds an "All athletes" entry at the top — for pages that filter a
  // list and default to showing everyone (Sessions), as opposed to
  // pages that always need exactly one athlete in context (Zones,
  // Analytics, Biomechanics, etc.), which omit this and keep their
  // existing single-athlete-only behavior unchanged.
  allowAll?: boolean;
  allLabel?: string;
}) {
  if (!roster || roster.length === 0) return null;
  const sel = roster.find((a) => a.id === value) ?? (myAthlete && myAthlete.id === value ? myAthlete : null);

  return (
    <div className="flex items-center gap-2">
      {sel && <UserAvatar name={sel.name} imageUrl={sel.profile_image_url} size="sm" />}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-[180px]">
          <SelectValue placeholder="Select athlete" />
        </SelectTrigger>
        <SelectContent>
          {allowAll && <SelectItem value="all">{allLabel}</SelectItem>}
          {myAthlete && <SelectItem value={myAthlete.id}>{myAthlete.name} (me)</SelectItem>}
          {roster
            .filter((a) => a.id !== myAthlete?.id)
            .map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  );
}
