import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Bandage, Thermometer, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  healthEventLabel,
  healthKindNoun,
  trainingImpactSummary,
  type HealthEventLike,
} from "@/lib/health-events";

// ----------------------------------------------------------------------------
// The health marker on a calendar day.
//
// Replaces a coloured bar that could say only "something was going on". An
// icon carries the kind at a glance — bandage for injury, thermometer for
// illness — and opening it answers the question the bar provoked without
// making a coach leave the calendar to do it.
//
// Injury and illness keep distinct colours, because the two lead to different
// decisions and the shape alone is small at this size.
// ----------------------------------------------------------------------------

export interface CalendarHealthEvent extends HealthEventLike {
  id: string;
  /** "active" — this day has been and gone. "expected" — a forecast. */
  state: "active" | "expected";
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function addDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

export function CalendarHealthIcon({
  events,
  date,
  onChanged,
}: {
  events: CalendarHealthEvent[];
  /** The day this icon sits on, used as the default resolution date. */
  date: string;
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!events || events.length === 0) return null;

  // Injury wins the icon when a day has both — a bandage next to a
  // thermometer at 12px is two smudges, and the injury is the one more likely
  // to change what the session should be.
  const primary = events.find((e) => healthKindNoun(e) === "injury") ?? events[0];
  const isInjury = healthKindNoun(primary) === "injury";
  const Icon = isInjury ? Bandage : Thermometer;

  // Expected days are drawn hollow. A forecast that looks identical to a
  // recorded fact is the thing this whole feature exists to stop.
  const allExpected = events.every((e) => e.state === "expected");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          // The day cell behind this is itself a click target — without this
          // the popover would open and the day sheet would open on top of it.
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "shrink-0 rounded-sm p-px transition-opacity hover:opacity-100",
            allExpected ? "opacity-50" : "opacity-90",
          )}
          title={events.map((e) => `${healthKindNoun(e)}: ${healthEventLabel(e)}`).join("\n")}
          aria-label={`${events.length} health record${events.length === 1 ? "" : "s"} on this day`}
        >
          <Icon
            className={cn("h-3 w-3", isInjury ? "text-amber-500" : "text-violet-500")}
            strokeWidth={allExpected ? 1.75 : 2.5}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="max-h-80 overflow-y-auto brand-scrollbar divide-y">
          {events.map((ev) => (
            <HealthEventPanel key={ev.id} event={ev} date={date} onChanged={onChanged} onClose={() => setOpen(false)} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function HealthEventPanel({
  event,
  date,
  onChanged,
  onClose,
}: {
  event: CalendarHealthEvent;
  date: string;
  onChanged?: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [showExpected, setShowExpected] = useState(false);
  const [expected, setExpected] = useState(event.expected_resolved_date ?? addDaysIso(date, 14));

  const isInjury = healthKindNoun(event) === "injury";
  const impact = trainingImpactSummary(event);

  async function patch(fields: Record<string, any>, message: string) {
    setBusy(true);
    const { error } = await (supabase as any).from("injuries").update(fields).eq("id", event.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(message);
    // Everything that reads health records, since this is reachable from the
    // calendar rather than from the page that owns them.
    qc.invalidateQueries({ queryKey: ["calendar-health"] });
    qc.invalidateQueries({ queryKey: ["injuries"] });
    qc.invalidateQueries({ queryKey: ["health-overview-injuries"] });
    qc.invalidateQueries({ queryKey: ["home-injuries"] });
    onChanged?.();
    onClose();
  }

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-start gap-2">
        {isInjury ? (
          <Bandage className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
        ) : (
          <Thermometer className="h-4 w-4 shrink-0 text-violet-500 mt-0.5" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-tight">{healthEventLabel(event)}</div>
          <div className="text-[11px] text-muted-foreground">
            Since {fmtDate(event.onset_date)}
            {event.severity != null && ` · ${event.severity}/5`}
            {event.expected_resolved_date && ` · expected clear ${fmtDate(event.expected_resolved_date)}`}
          </div>
        </div>
        {event.state === "expected" && (
          <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">
            expected
          </Badge>
        )}
      </div>

      {impact && <p className="text-[11px] text-muted-foreground">{impact}</p>}
      {event.notes && <p className="text-[11px] text-muted-foreground line-clamp-3">{event.notes}</p>}

      {showExpected ? (
        <div className="space-y-2">
          <div>
            <Label className="text-[11px]">Expected to clear by</Label>
            <Input
              type="date"
              value={expected}
              min={event.onset_date ?? undefined}
              onChange={(e) => setExpected(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          {/* Said plainly, because the two buttons below do genuinely
              different things and the difference is easy to lose. */}
          <p className="text-[11px] text-muted-foreground">
            A forecast, not a record. The marker stops after this date, and the days between now and then show as
            expected rather than as fact. Marking it resolved later is what actually ends it.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowExpected(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={busy || !expected}
              onClick={() => patch({ expected_resolved_date: expected }, "Expected clear date set")}
            >
              {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={busy}
            onClick={() =>
              patch(
                // Dated to the day that was clicked, not to today. Clicking
                // back on the Tuesday it actually cleared should record the
                // Tuesday.
                { status: "resolved", resolved_date: date, expected_resolved_date: null },
                `Marked resolved ${fmtDate(date)}`,
              )
            }
          >
            Mark resolved
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => setShowExpected(true)}>
            {event.expected_resolved_date ? "Change expected date" : "Set expected date"}
          </Button>
        </div>
      )}
    </div>
  );
}
