import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user-avatar";
import { toast } from "sonner";
import { Upload, ZoomIn, ZoomOut, RotateCcw, Pencil } from "lucide-react";

const MAX_BYTES = 5 * 1024 * 1024;
const TARGET = 400; // output square size, baked into the uploaded JPEG
const VIEW = 280; // cropper viewport size in CSS px — the circle you drag/zoom within
const MAX_ZOOM = 3;

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    // Deliberately NOT revoking the object URL here — the dialog re-uses
    // this same URL for its own <img> tag, which needs it to still
    // resolve. See the cleanup effect in the component for where this
    // actually gets released once the crop session is over.
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    img.src = url;
  });
}

// For "Edit photo" on an already-saved image — loads from the existing
// signed URL instead of a freshly-picked file. crossOrigin is required to
// read pixel data back out for the bake step below; if the storage host
// doesn't send CORS headers this will fail (a tainted-canvas SecurityError
// on bake, or occasionally an onerror here), which is surfaced as a clear
// toast rather than a silent broken cropper.
function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load your current photo for editing"));
    img.src = url;
  });
}

function clampOffset(o: { x: number; y: number }, effW: number, effH: number) {
  const maxX = Math.max(0, (effW - VIEW) / 2);
  const maxY = Math.max(0, (effH - VIEW) / 2);
  return { x: Math.min(maxX, Math.max(-maxX, o.x)), y: Math.min(maxY, Math.max(-maxY, o.y)) };
}

/**
 * Bakes the current pan/zoom crop into a square JPEG at TARGET resolution.
 * `baseScale` is whatever scale made the image cover the VIEW×VIEW circle
 * at zoom=1 (see the `cover` calculation in the component below) — this
 * needs that same value back to reproduce exactly what was on screen.
 * `offset` is in real screen pixels, independent of zoom (dragging always
 * moves the image 1:1 with the pointer regardless of zoom level — see the
 * transform composition in the component for why that holds).
 */
async function bakeCroppedJpeg(img: HTMLImageElement, baseScale: number, zoom: number, offset: { x: number; y: number }): Promise<Blob> {
  const scale = baseScale * zoom;
  const sourceW = VIEW / scale;
  const sourceH = VIEW / scale;
  const sourceX = img.width / 2 - (VIEW / 2 + offset.x) / scale;
  const sourceY = img.height / 2 - (VIEW / 2 + offset.y) / scale;

  const canvas = document.createElement("canvas");
  canvas.width = TARGET;
  canvas.height = TARGET;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, TARGET, TARGET);
  return await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("Encoding failed"))), "image/jpeg", 0.9),
  );
}

export function ProfileImageUploader({ userId, name }: { userId: string; name: string }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingCurrent, setEditingCurrent] = useState(false); // true when the cropper was opened via "Edit photo" on an already-saved image, rather than a fresh upload

  // Cropper state — kept around (not cleared) after applying so "Adjust
  // crop" from the confirm step can reopen it with the same image and
  // pan/zoom rather than forcing a fresh file pick.
  const [cropperOpen, setCropperOpen] = useState(false);
  const [cropImg, setCropImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const draggingRef = useRef<{ x: number; y: number; offX: number; offY: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const baseScale = cropImg ? Math.max(VIEW / cropImg.width, VIEW / cropImg.height) : 1;
  // Fixed base size at zoom=1 — zoom is applied purely as a CSS
  // transform: scale() below, never by recomputing width/height. A single
  // scalar scale() cannot distort proportions the way a bug in a
  // width/height recalculation could, so this is the more robust way to
  // guarantee the image never renders stretched.
  const baseDispW = cropImg ? cropImg.width * baseScale : 0;
  const baseDispH = cropImg ? cropImg.height * baseScale : 0;

  useEffect(() => {
    return () => {
      if (cropImg) URL.revokeObjectURL(cropImg.src);
    };
  }, [cropImg]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  // Wheel-to-zoom, attached as a genuine native listener rather than
  // React's onWheel — React can attach wheel/touch listeners as passive
  // for scroll-performance reasons, and a passive listener silently can't
  // preventDefault() the page/dialog from scrolling instead of the image
  // actually zooming. A manually-attached listener with passive:false
  // guarantees this works instead of depending on React's internal
  // event-handling behavior.
  //
  // zoomRef mirrors the zoom state so the listener (attached once per
  // cropper session, not re-attached on every zoom tick) always reads the
  // current value without needing to be re-created as a dependency.
  const zoomRef = useRef(1);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !cropperOpen || !cropImg) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      setZoomAndClamp(zoomRef.current - e.deltaY * 0.0015);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropperOpen, cropImg]);

  const { data: profile } = useQuery({
    queryKey: ["profile-image", userId],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("profile_image_url").eq("id", userId).maybeSingle();
      return data;
    },
  });
  const currentUrl = profile?.profile_image_url ?? null;

  function openCropperWith(img: HTMLImageElement, fromCurrent: boolean) {
    setCropImg(img);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setEditingCurrent(fromCurrent);
    setCropperOpen(true);
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX_BYTES) { toast.error("Image must be 5MB or less"); return; }
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { toast.error("Use JPG, PNG, or WebP"); return; }
    try {
      const img = await loadImageFromFile(f);
      openCropperWith(img, false);
    } catch (err: any) {
      toast.error(err.message ?? "Could not read image");
    }
  }

  async function onEditCurrent() {
    if (!currentUrl) return;
    setBusy(true);
    try {
      const img = await loadImageFromUrl(currentUrl);
      openCropperWith(img, true);
    } catch (err: any) {
      toast.error(err.message ?? "Couldn't load your current photo for editing — try re-uploading it instead");
    } finally {
      setBusy(false);
    }
  }

  function setZoomAndClamp(nz: number) {
    if (!cropImg) return;
    const z = Math.min(MAX_ZOOM, Math.max(1, nz));
    setZoom(z);
    setOffset((o) => clampOffset(o, baseDispW * z, baseDispH * z));
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // setPointerCapture can throw in some environments/edge cases — if it
    // does, the rest of this handler (which actually starts the drag)
    // must still run, otherwise a capture failure silently prevents
    // dragging from ever starting at all.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* non-fatal — dragging still works without capture, it's just less robust if the pointer leaves the element */
    }
    draggingRef.current = { x: e.clientX, y: e.clientY, offX: offset.x, offY: offset.y };
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current || !cropImg) return;
    const dx = e.clientX - draggingRef.current.x;
    const dy = e.clientY - draggingRef.current.y;
    const effW = baseDispW * zoom;
    const effH = baseDispH * zoom;
    setOffset(clampOffset({ x: draggingRef.current.offX + dx, y: draggingRef.current.offY + dy }, effW, effH));
  }
  function endDrag() {
    draggingRef.current = null;
  }

  async function applyCrop() {
    if (!cropImg) return;
    try {
      const blob = await bakeCroppedJpeg(cropImg, baseScale, zoom, offset);
      setPreviewBlob(blob);
      setPreview(URL.createObjectURL(blob));
      setCropperOpen(false);
    } catch (err: any) {
      // Most likely cause here specifically: cropImg was loaded via
      // loadImageFromUrl (Edit photo) and the storage host isn't sending
      // CORS headers, tainting the canvas and blocking pixel readout.
      toast.error(
        editingCurrent
          ? "Couldn't process this crop — your photo host may not allow re-editing directly. Try downloading and re-uploading it instead."
          : (err.message ?? "Could not crop image"),
      );
    }
  }

  async function confirm() {
    if (!previewBlob) return;
    setBusy(true);
    try {
      const path = `${userId}/avatar-${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage.from("profiles").upload(path, previewBlob, {
        contentType: "image/jpeg", upsert: false,
      });
      if (upErr) throw upErr;
      const { data: signed, error: signErr } = await supabase.storage.from("profiles").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
      if (signErr) throw signErr;
      const url = signed.signedUrl;
      const { error: profErr } = await supabase.from("profiles").update({ profile_image_url: url }).eq("id", userId);
      if (profErr) throw profErr;
      // Mirror to athletes row for unclaimed/coach-managed display
      await supabase.from("athletes").update({ profile_image_url: url }).eq("user_id", userId);
      // Clean up previous file
      try {
        const prev = currentUrl;
        if (prev) {
          const m = prev.match(/profiles\/([^?]+)/);
          if (m && m[1] && m[1] !== path) await supabase.storage.from("profiles").remove([m[1]]);
        }
      } catch {}
      toast.success("Photo updated");
      setPreview(null); setPreviewBlob(null); setCropImg(null);
      qc.invalidateQueries({ queryKey: ["profile-image", userId] });
      qc.invalidateQueries({ queryKey: ["dashboard-alerts"] });
      qc.invalidateQueries({ queryKey: ["msg-contacts"] });
      qc.invalidateQueries({ queryKey: ["noticeboard"] });
      qc.invalidateQueries({ queryKey: ["roster"] });
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      if (currentUrl) {
        const m = currentUrl.match(/profiles\/([^?]+)/);
        if (m && m[1]) await supabase.storage.from("profiles").remove([m[1]]);
      }
      await supabase.from("profiles").update({ profile_image_url: null }).eq("id", userId);
      await supabase.from("athletes").update({ profile_image_url: null }).eq("user_id", userId);
      toast.success("Photo removed");
      qc.invalidateQueries({ queryKey: ["profile-image", userId] });
      qc.invalidateQueries({ queryKey: ["dashboard-alerts"] });
      qc.invalidateQueries({ queryKey: ["msg-contacts"] });
      qc.invalidateQueries({ queryKey: ["noticeboard"] });
      qc.invalidateQueries({ queryKey: ["roster"] });
    } catch (e: any) {
      toast.error(e.message ?? "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile photo</CardTitle>
        <CardDescription>JPG, PNG, or WebP up to 5MB. You'll be able to drag and zoom before it's saved.</CardDescription>
      </CardHeader>
      <CardContent className="flex items-start gap-4">
        <div className="shrink-0">
          {preview ? (
            <img src={preview} alt="Preview" className="h-20 w-20 rounded-full object-cover ring-2 ring-[var(--accent-red)]" />
          ) : (
            <UserAvatar name={name} imageUrl={currentUrl} size="xl" />
          )}
        </div>
        <div className="flex flex-col gap-2">
          {preview ? (
            <>
              <p className="text-xs text-muted-foreground">Looks good?</p>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" onClick={confirm} disabled={busy}>{busy ? "Uploading…" : "Use this photo"}</Button>
                {cropImg && (
                  <Button size="sm" variant="outline" onClick={() => setCropperOpen(true)} disabled={busy}>
                    Adjust crop
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setPreview(null); setPreviewBlob(null); setCropImg(null); }}
                  disabled={busy}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={onPick}
                className="hidden"
              />
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
                  <Upload className="h-4 w-4 mr-1.5" /> {currentUrl ? "Replace photo" : "Upload photo"}
                </Button>
                {currentUrl && (
                  <Button size="sm" variant="outline" onClick={onEditCurrent} disabled={busy}>
                    <Pencil className="h-4 w-4 mr-1.5" /> Edit photo
                  </Button>
                )}
              </div>
              {currentUrl && (
                <button onClick={remove} disabled={busy} className="text-xs text-muted-foreground hover:text-destructive text-left">
                  Remove photo
                </button>
              )}
            </>
          )}
        </div>
      </CardContent>

      <Dialog open={cropperOpen} onOpenChange={(open) => !open && setCropperOpen(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingCurrent ? "Edit your photo" : "Adjust your photo"}</DialogTitle>
            <DialogDescription>Drag to reposition, scroll or use the slider to zoom. This is exactly how it'll look everywhere.</DialogDescription>
          </DialogHeader>

          {cropImg && (
            <div className="flex flex-col items-center gap-4">
              <div
                ref={viewportRef}
                className="relative rounded-full overflow-hidden border-2 border-[var(--accent-red)] cursor-grab active:cursor-grabbing touch-none select-none"
                style={{ width: VIEW, height: VIEW, background: "#000" }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerLeave={endDrag}
                onPointerCancel={endDrag}
              >
                <img
                  src={cropImg.src}
                  alt=""
                  draggable={false}
                  className="absolute pointer-events-none"
                  style={{
                    top: "50%",
                    left: "50%",
                    width: baseDispW,
                    height: baseDispH,
                    // Composition matters: scale() (innermost) zooms the
                    // image around its own center; the pixel translate
                    // (middle) then pans that already-scaled image by a
                    // fixed screen-pixel amount, unaffected by zoom — so
                    // dragging always feels 1:1 with the pointer no matter
                    // how zoomed in you are; the outer -50%/-50% centers
                    // the whole thing in the viewport. A single scale()
                    // factor is applied identically to both axes, so this
                    // can't stretch the image out of proportion the way a
                    // width/height miscalculation could.
                    transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                  }}
                />
              </div>

              <div className="flex items-center gap-3 w-full">
                <ZoomOut className="h-4 w-4 text-muted-foreground shrink-0" />
                <Slider
                  min={1}
                  max={MAX_ZOOM}
                  step={0.01}
                  value={[zoom]}
                  onValueChange={(v) => setZoomAndClamp(v[0])}
                  className="flex-1"
                />
                <ZoomIn className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs text-muted-foreground -mt-2"
                onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}
              >
                <RotateCcw className="h-3 w-3 mr-1.5" /> Reset
              </Button>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCropperOpen(false)}>
              Cancel
            </Button>
            <Button onClick={applyCrop}>Apply crop</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
