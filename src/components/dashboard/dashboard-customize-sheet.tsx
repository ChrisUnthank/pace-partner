import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { widgetsForRole, type DashboardRole, type DashboardWidgetId } from "@/lib/dashboard-layout";

// The list-based half of dashboard customization — dragging happens live
// on the page (DashboardGrid); this is where a hidden widget gets turned
// back on, since "find it and drag it back" isn't discoverable once it's
// off the page entirely.
export function DashboardCustomizeSheet({
  open,
  onOpenChange,
  role,
  hidden,
  onToggle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: DashboardRole;
  hidden: Set<DashboardWidgetId>;
  onToggle: (id: DashboardWidgetId, isHidden: boolean) => void;
}) {
  const widgets = widgetsForRole(role);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Widgets</SheetTitle>
          <SheetDescription>
            Turn widgets on or off. Drag them on the dashboard itself to change the order.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-1.5">
          {widgets.map((w) => {
            const Icon = w.icon;
            const isVisible = !hidden.has(w.id);
            return (
              <div key={w.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5">
                <span className="h-8 w-8 shrink-0 rounded-md bg-accent grid place-items-center">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{w.label}</div>
                  <div className="text-xs text-muted-foreground truncate">{w.description}</div>
                </div>
                <Switch checked={isVisible} onCheckedChange={(v) => onToggle(w.id, !v)} />
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
