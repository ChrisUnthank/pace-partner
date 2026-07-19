// gallery-layout-fields.tsx
// The two dropdowns that control gallery grid density and crop shape —
// shared between the coach and athlete editors since the underlying
// columns/aspect values and their meaning are identical on both pages.
// Per-image repositioning reuses HeroImagePositionPicker directly (it's
// already generic — "pick a focal point on any image"), so no separate
// component is needed for that part.

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function GalleryLayoutFields({
  columns,
  aspect,
  onColumnsChange,
  onAspectChange,
}: {
  columns: number;
  aspect: string;
  onColumnsChange: (v: number) => void;
  onAspectChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Thumbnails per row</label>
        <Select value={String(columns)} onValueChange={(v) => onColumnsChange(Number(v))}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2">2 (larger)</SelectItem>
            <SelectItem value="3">3</SelectItem>
            <SelectItem value="4">4 (smaller)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Crop shape</label>
        <Select value={aspect} onValueChange={onAspectChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="square">Square</SelectItem>
            <SelectItem value="portrait">Portrait (taller)</SelectItem>
            <SelectItem value="landscape">Landscape (wider)</SelectItem>
            <SelectItem value="auto">No crop — natural size</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
