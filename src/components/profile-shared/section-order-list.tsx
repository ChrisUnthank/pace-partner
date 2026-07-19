// section-order-list.tsx
// Generic drag-to-reorder list for page sections, and the small status
// dot used both here and for tab-completion indicators. Takes a plain
// array of keys plus an isOn/onReorder pair — no coach- or athlete-
// specific logic inside, so both editors can share one implementation
// instead of drifting copies.

import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export function Dot({ done }: { done: boolean }) {
  return (
    <span
      className={cn("h-1.5 w-1.5 shrink-0 rounded-full", done ? "bg-emerald-500" : "bg-muted-foreground/40")}
      aria-hidden
    />
  );
}

export function SectionOrderList({
  order,
  labels,
  isOn,
  onReorder,
}: {
  order: string[];
  labels: Record<string, string>;
  isOn: (key: string) => boolean;
  onReorder: (next: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(ev: DragEndEvent) {
    const { active, over } = ev;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(order, from, to));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <div className="space-y-1.5">
          {order.map((key, i) => (
            <SortableSectionRow key={key} id={key} position={i + 1} label={labels[key] ?? key} on={isOn(key)} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableSectionRow({
  id,
  position,
  label,
  on,
}: {
  id: string;
  position: number;
  label: string;
  on: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm"
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="w-5 text-xs text-muted-foreground">{position}.</span>
      <Dot done={on} />
      <span className="flex-1">{label}</span>
      {!on && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Hidden</span>}
    </div>
  );
}
