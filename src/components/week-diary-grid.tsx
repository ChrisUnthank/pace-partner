import type { ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Tweek-style week diary: seven day-columns laid out horizontally
 * (Mon–Sun) instead of a vertical agenda list — deliberately distinct
 * from the Sessions Calendar's own grid (that one's an hour/month
 * training calendar; this is a lightweight personal diary). Shared
 * between the coach Diary and the athlete/parent My Schedule Diary tab so
 * both get the same navigation and drag behavior rather than two
 * hand-rolled implementations drifting apart.
 *
 * Only ONE-OFF personal items (a specific_date, not a weekly day_of_week
 * pattern) are draggable between days — moving a single occurrence of a
 * recurring item would mean silently converting it into a one-off
 * exception, which is a bigger decision than a drag should make quietly.
 * Recurring items render locked in place; callers should render a small
 * indicator (e.g. a repeat icon) so it's clear why. Training-schedule
 * entries are always read-only here regardless of recurrence — moving a
 * squad training slot is a distinct, larger feature (it would need to
 * write a dated override), not something this diary drag handles.
 */

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday of the week `offset` weeks from the current real week (0 = this week). */
export function getWeekStart(offset: number): string {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dow = now.getDay() || 7; // Mon=1..Sun=7
  const monday = new Date(now);
  monday.setDate(now.getDate() - dow + 1 + offset * 7);
  return toISO(monday);
}

/** The seven ISO dates (Mon–Sun) for a given Monday `weekStart`. */
export function getWeekDates(weekStart: string): string[] {
  const start = new Date(weekStart + "T00:00:00");
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    out.push(toISO(d));
  }
  return out;
}

function formatRangeLabel(weekStart: string) {
  const start = new Date(weekStart + "T00:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const startLabel = start.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const endLabel = end.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return `${startLabel} – ${endLabel}`;
}

export type WeekDiaryDay = {
  date: string; // ISO
  training: any[];
  personal: any[];
  // Optional — set when a Deliver Program batch's date range covers this
  // day. Rendered as a small chip in the day header. Callers compute this
  // themselves (see listAthletePlanDeliveries in plan-delivery.functions.ts)
  // since it depends on which athlete's diary is being shown.
  delivered?: { label: string } | null;
};

function DraggablePersonalCard({
  id,
  entry,
  draggable,
  children,
}: {
  id: string;
  entry: any;
  draggable: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    data: { entry },
    disabled: !draggable,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50, position: "relative" as const }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(draggable ? attributes : {})}
      {...(draggable ? listeners : {})}
      className={cn(isDragging && "opacity-50", draggable && "cursor-grab active:cursor-grabbing")}
    >
      {children}
    </div>
  );
}

function DayColumn({
  date,
  isToday,
  day,
  renderTraining,
  renderPersonal,
  isPersonalDraggable,
  onAddClick,
}: {
  date: string;
  isToday: boolean;
  day: WeekDiaryDay;
  renderTraining: (item: any) => ReactNode;
  renderPersonal: (item: any) => ReactNode;
  isPersonalDraggable: (item: any) => boolean;
  onAddClick: (date: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: date });
  const d = new Date(date + "T00:00:00");
  const dow = WEEKDAY_SHORT[(d.getDay() + 6) % 7];

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col w-full min-w-0 rounded-lg border bg-card transition-colors",
        isToday && "border-[var(--accent-red)]",
        isOver && "bg-accent/40",
      )}
    >
      <div
        className={cn(
          "px-2.5 py-2 border-b flex items-center justify-between",
          isToday && "bg-[var(--accent-red)]/5",
        )}
      >
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{dow}</div>
          <div className={cn("text-sm font-semibold", isToday && "text-[var(--accent-red)]")}>{d.getDate()}</div>
          {day.delivered && (
            <div
              className="text-[9px] leading-tight text-emerald-700 bg-emerald-100 border border-emerald-200 rounded px-1 mt-0.5 inline-block"
              title={day.delivered.label}
            >
              {day.delivered.label}
            </div>
          )}
        </div>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onAddClick(date)}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex-1 p-1.5 space-y-1.5 min-h-24 max-h-[60vh] overflow-y-auto">
        {day.training.map((t) => (
          <div key={t.id}>{renderTraining(t)}</div>
        ))}
        {day.personal.map((p) => (
          <DraggablePersonalCard key={p.id} id={p.id} entry={p} draggable={isPersonalDraggable(p)}>
            {renderPersonal(p)}
          </DraggablePersonalCard>
        ))}
        {day.training.length === 0 && day.personal.length === 0 && (
          <div className="text-[11px] text-muted-foreground/50 text-center py-4">—</div>
        )}
      </div>
    </div>
  );
}

export function WeekDiaryGrid({
  weekStart,
  onPrev,
  onNext,
  onToday,
  days,
  todayISO,
  renderTraining,
  renderPersonal,
  isPersonalDraggable,
  onAddClick,
  onDropPersonal,
}: {
  weekStart: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  days: WeekDiaryDay[];
  todayISO: string;
  renderTraining: (item: any) => ReactNode;
  renderPersonal: (item: any) => ReactNode;
  isPersonalDraggable: (item: any) => boolean;
  onAddClick: (date: string) => void;
  onDropPersonal: (entry: any, toDate: string) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function handleDragEnd(e: DragEndEvent) {
    const toDate = e.over?.id as string | undefined;
    const entry = e.active?.data?.current?.entry;
    if (!toDate || !entry) return;
    if (entry.specific_date === toDate) return;
    onDropPersonal(entry, toDate);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" className="h-7 w-7" onClick={onPrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onToday}>
            Today
          </Button>
          <Button size="icon" variant="outline" className="h-7 w-7" onClick={onNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="text-sm font-medium text-muted-foreground">{formatRangeLabel(weekStart)}</div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-7 gap-2">
          {days.map((day) => (
            <DayColumn
              key={day.date}
              date={day.date}
              isToday={day.date === todayISO}
              day={day}
              renderTraining={renderTraining}
              renderPersonal={renderPersonal}
              isPersonalDraggable={isPersonalDraggable}
              onAddClick={onAddClick}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
