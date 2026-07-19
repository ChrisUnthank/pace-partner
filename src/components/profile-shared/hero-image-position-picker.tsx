// hero-image-position-picker.tsx
// Click-anywhere-on-the-image focal-point picker for the hero image —
// shared between the coach and athlete editors since both hero layouts
// use the same object-position mechanism. Purely a controlled x/y (0-100)
// input; knows nothing about coach or athlete config shapes.

import { useRef, useState } from "react";

export function HeroImagePositionPicker({
  imageUrl,
  x,
  y,
  onChange,
}: {
  imageUrl: string;
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  function handlePick(clientX: number, clientY: number) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const nx = Math.round(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
    const ny = Math.round(Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100)));
    onChange(nx, ny);
  }

  if (!imageUrl) return null;

  return (
    <div className="space-y-2">
      <div
        ref={ref}
        onMouseDown={(e) => {
          setDragging(true);
          handlePick(e.clientX, e.clientY);
        }}
        onMouseMove={(e) => {
          if (dragging) handlePick(e.clientX, e.clientY);
        }}
        onMouseUp={() => setDragging(false)}
        onMouseLeave={() => setDragging(false)}
        className="relative aspect-[21/9] w-full cursor-crosshair overflow-hidden rounded-md border select-none"
        role="button"
        tabIndex={0}
        aria-label="Click or drag to set the hero image's focal point"
        onKeyDown={(e) => {
          const step = 5;
          if (e.key === "ArrowLeft") onChange(Math.max(0, x - step), y);
          if (e.key === "ArrowRight") onChange(Math.min(100, x + step), y);
          if (e.key === "ArrowUp") onChange(x, Math.max(0, y - step));
          if (e.key === "ArrowDown") onChange(x, Math.min(100, y + step));
        }}
      >
        <img
          src={imageUrl}
          alt=""
          className="pointer-events-none h-full w-full object-cover"
          style={{ objectPosition: `${x}% ${y}%` }}
        />
        <div
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/40 shadow"
          style={{ left: `${x}%`, top: `${y}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Click or drag anywhere on the preview to set what stays visible when the image gets cropped at different
        screen sizes. Arrow keys work too, once focused.
      </p>
    </div>
  );
}
