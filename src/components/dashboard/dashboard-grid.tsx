import { ReactNode, CSSProperties } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

// Same dnd-kit setup as profile-shared/section-order-list.tsx (drag
// sensor config, arrayMove-on-drop), applied to a live 3-column grid of
// widget cards instead of a settings-panel list (was 2-column — widened
// so a 2/3-width widget can sit beside a 1/3-width one) — this is the
// "drag directly on the page" half of dashboard customization; the
// "pick from a list" half is DashboardCustomizeSheet.
//
// `grid-flow-row-dense` on the container is what makes row-spanning
// widgets (Calendar, currently the only one) not leave a gap in the
// grid — without it, CSS grid's default "sparse" auto-placement would
// skip the slot beside a tall item entirely rather than filling it with
// the next item that fits, leaving a hole under the tall widget.
export function DashboardGrid({
  ids,
  sizes,
  editMode,
  onReorder,
  onHide,
  renderWidget,
  columns = 3,
}: {
  ids: string[];
  sizes: Record<string, { span: 1 | 2 | 3; rowSpan?: 1 | 2 }>;
  editMode: boolean;
  onReorder: (next: string[]) => void;
  onHide: (id: string) => void;
  renderWidget: (id: string) => ReactNode;
  // 1 = a narrow single-column zone (used by the coach dashboard's main/
  // sidebar split below) — every item renders at full width of this
  // column regardless of its own catalog `span` value (span gets
  // clamped to `columns` below, in the render loop). Default 3
  // preserves every existing call site's behavior unchanged.
  columns?: 1 | 2 | 3;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(ev: DragEndEvent) {
    const { active, over } = ev;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(ids, from, to));
  }

  const colsClass = columns === 1 ? "md:grid-cols-1" : columns === 2 ? "md:grid-cols-2" : "md:grid-cols-3";

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className={`grid grid-cols-1 ${colsClass} md:grid-flow-row-dense gap-4`}>
          {ids.map((id, i) => (
            <DashboardGridItem
              key={id}
              id={id}
              index={i}
              // Clamped to the grid's actual column count — a catalog
              // span of 2 or 3 means nothing in a narrow columns={1}
              // zone (main/sidebar on the coach dashboard) beyond
              // "full width of this column", and passing the raw
              // uncapped value through would make the item request
              // more grid columns than this container actually has.
              // CSS Grid's real response to that is to grow implicit
              // columns to fit the span, not clamp it — which is what
              // broke the narrow columns into overlapping cards.
              span={Math.min(sizes[id]?.span ?? 1, columns) as 1 | 2 | 3}
              rowSpan={sizes[id]?.rowSpan ?? 1}
              editMode={editMode}
              onHide={() => onHide(id)}
            >
              {renderWidget(id)}
            </DashboardGridItem>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function DashboardGridItem({
  id,
  index,
  span,
  rowSpan,
  editMode,
  onHide,
  children,
}: {
  id: string;
  index: number;
  span: 1 | 2 | 3;
  rowSpan: 1 | 2;
  editMode: boolean;
  onHide: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !editMode,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    animationDelay: `${Math.min(index, 8) * 50}ms`,
    animationFillMode: "backwards",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative h-full animate-in fade-in-0 slide-in-from-bottom-2 duration-500",
        span === 2 && "md:col-span-2",
        span === 3 && "md:col-span-3",
        rowSpan === 2 && "md:row-span-2",
        editMode && "rounded-xl ring-2 ring-[var(--accent-red)]/30",
      )}
    >
      {editMode && (
        <div className="absolute -top-3 right-2 z-10 flex items-center gap-1">
          <button
            type="button"
            className="h-7 w-7 grid place-items-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:text-foreground cursor-grab active:cursor-grabbing"
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onHide}
            className="h-7 w-7 grid place-items-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:text-destructive"
            aria-label="Hide widget"
          >
            <EyeOff className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
