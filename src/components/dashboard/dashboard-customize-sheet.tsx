import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { widgetsForRole, type DashboardRole, type DashboardWidgetId } from "@/lib/dashboard-layout";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

// The list-based half of dashboard customization — this is now also where
// reordering can happen directly (drag the grip on a row), not just on the
// live dashboard grid itself. Same dnd-kit setup as DashboardGrid, just a
// vertical list instead of a 2-column grid — both call the same
// layout.reorder() in the end, so dragging here and dragging on the page
// stay in sync with each other.
export function DashboardCustomizeSheet({
  open,
  onOpenChange,
  role,
  order,
  hidden,
  onToggle,
  onReorder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: DashboardRole;
  order: DashboardWidgetId[];
  hidden: Set<DashboardWidgetId>;
  onToggle: (id: DashboardWidgetId, isHidden: boolean) => void;
  onReorder: (next: DashboardWidgetId[]) => void;
}) {
  const catalog = widgetsForRole(role);
  const byId = new Map(catalog.map((w) => [w.id, w]));
  // `order` is the source of truth for sequence; fall back to catalog
  // order for any id that hasn't made it into a saved layout yet (mirrors
  // the same "missing ids get appended" merge logic useDashboardLayout
  // already does elsewhere).
  const orderedIds = order.filter((id) => byId.has(id));
  for (const w of catalog) if (!orderedIds.includes(w.id)) orderedIds.push(w.id);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(ev: DragEndEvent) {
    const { active, over } = ev;
    if (!over || active.id === over.id) return;
    const from = orderedIds.indexOf(active.id as DashboardWidgetId);
    const to = orderedIds.indexOf(over.id as DashboardWidgetId);
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(orderedIds, from, to));
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto brand-scrollbar">
        <SheetHeader>
          <SheetTitle>Widgets</SheetTitle>
          <SheetDescription>Turn widgets on or off, or drag the handle to reorder them.</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
              <div className="space-y-1.5">
                {orderedIds.map((id) => {
                  const w = byId.get(id);
                  if (!w) return null;
                  return (
                    <SortableWidgetRow
                      key={id}
                      id={id}
                      icon={w.icon}
                      label={w.label}
                      description={w.description}
                      isVisible={!hidden.has(id)}
                      onToggle={(v) => onToggle(id, !v)}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SortableWidgetRow({
  id,
  icon: Icon,
  label,
  description,
  isVisible,
  onToggle,
}: {
  id: string;
  icon: any;
  label: string;
  description: string;
  isVisible: boolean;
  onToggle: (v: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 bg-background"
    >
      <button
        type="button"
        className="h-7 w-7 shrink-0 grid place-items-center rounded text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="h-8 w-8 shrink-0 rounded-md bg-accent grid place-items-center">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground truncate">{description}</div>
      </div>
      <Switch checked={isVisible} onCheckedChange={onToggle} />
    </div>
  );
}
