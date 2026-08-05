import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user-avatar";
import { toast } from "sonner";
import { Upload, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

const MAX_BYTES = 5 * 1024 * 1024;
const TARGET = 400; // output square size, baked into the uploaded JPEG
const VIEW = 280; // cropper viewport size in CSS px — the circle you drag/zoom within
const MAX_ZOOM = 3;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    // Deliberately NOT revoking the object URL here. The dialog below
    // re-renders this same image via a fresh <img src={cropImg.src}> tag,
    // which needs the URL to still resolve — an already-decoded Image
    // element keeps working after its URL is revoked, but a brand new
    // <img> tag pointed at the same (now-invalid) URL string won't load
    // anything at all. See the cleanup effect in the component below for
    // where this actually gets revoked once the crop session is over.
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    img.src = url;
  });
}

function clampOffset(o: { x: number; y: number }, dispW: number, dispH: number) {
  const maxX = Math.max(0, (dispW - VIEW) / 2);
  const maxY = Math.max(0, (dispH - VIEW) / 2);
  return { x: Math.min(maxX, Math.max(-maxX, o.x)), y: Math.min(maxY, Math.max(-maxY, o.y)) };
}

/**
 * Bakes the current pan/zoom crop into a square JPEG at TARGET resolution.
 * `baseScale` is whatever scale made the image cover the VIEW×VIEW circle
 * at zoom=1 — see the `cover` calculation in the component below, this
 * just needs the same value back to reproduce exactly what was on screen.
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

  // Cropper state — kept around (not cleared) after applying so "Adjust
  // crop" from the confirm step can reopen it with the same image and
  // pan/zoom rather than forcing a fresh file pick.
  const [cropperOpen, setCropperOpen] = useState(false);
  const [cropImg, setCropImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const draggingRef = useRef<{ x: number; y: number; offX: number; offY: number } | null>(null);

  const baseScale = cropImg ? Math.max(VIEW / cropImg.width, VIEW / cropImg.height) : 1;
  const dispW = cropImg ? cropImg.width * baseScale * zoom : 0;
  const dispH = cropImg ? cropImg.height * baseScale * zoom : 0;

  // Revokes the previous image's object URL whenever cropImg changes to a
  // new value (a fresh pick) or the component unmounts — the one place
  // this needs to happen, now that loadImage() above deliberately doesn't
  // do it eagerly.
  useEffect(() => {
    return () => {
      if (cropImg) URL.revokeObjectURL(cropImg.src);
    };
  }, [cropImg]);

  // Same reasoning for the baked-crop preview blob's own object URL.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const { data: profile } = useQuery({
    queryKey: ["profile-image", userId],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("profile_image_url").eq("id", userId).maybeSingle();
      return data;
    },
  });
  const currentUrl = profile?.profile_image_url ?? null;

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX_BYTES) { toast.error("Image must be 5MB or less"); return; }
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { toast.error("Use JPG, PNG, or WebP"); return; }
    try {
      const img = await loadImage(f);
      setCropImg(img);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setCropperOpen(true);
    } catch (err: any) {
      toast.error(err.message ?? "Could not read image");
    }
  }

  function setZoomClamped(nz: number) {
    if (!cropImg) return;
    const z = Math.min(MAX_ZOOM, Math.max(1, nz));
    setZoom(z);
    const newDispW = cropImg.width * baseScale * z;
    const newDispH = cropImg.height * baseScale * z;
    setOffset((o) => clampOffset(o, newDispW, newDispH));
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = { x: e.clientX, y: e.clientY, offX: offset.x, offY: offset.y };
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    const dx = e.clientX - draggingRef.current.x;
    const dy = e.clientY - draggingRef.current.y;
    setOffset(clampOffset({ x: draggingRef.current.offX + dx, y: draggingRef.current.offY + dy }, dispW, dispH));
  }
  function onPointerUp() {
    draggingRef.current = null;
  }
  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    setZoomClamped(zoom - e.deltaY * 0.0015);
  }

  async function applyCrop() {
    if (!cropImg) return;
    try {
      const blob = await bakeCroppedJpeg(cropImg, baseScale, zoom, offset);
      setPreviewBlob(blob);
      setPreview(URL.createObjectURL(blob));
      setCropperOpen(false);
    } catch (err: any) {
      toast.error(err.message ?? "Could not crop image");
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
              <div className="flex gap-2">
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
              <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
                <Upload className="h-4 w-4 mr-1.5" /> {currentUrl ? "Replace photo" : "Upload photo"}
              </Button>
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
            <DialogTitle>Adjust your photo</DialogTitle>
            <DialogDescription>Drag to reposition, scroll or use the slider to zoom. This is exactly how it'll look everywhere.</DialogDescription>
          </DialogHeader>

          {cropImg && (
            <div className="flex flex-col items-center gap-4">
              <div
                className="relative rounded-full overflow-hidden border-2 border-[var(--accent-red)] cursor-grab active:cursor-grabbing touch-none select-none"
                style={{ width: VIEW, height: VIEW, background: "#000" }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
                onWheel={onWheel}
              >
                <img
                  src={cropImg.src}
                  alt=""
                  draggable={false}
                  className="absolute pointer-events-none"
                  style={{
                    width: dispW,
                    height: dispH,
                    left: VIEW / 2 - dispW / 2 + offset.x,
                    top: VIEW / 2 - dispH / 2 + offset.y,
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
                  onValueChange={(v) => setZoomClamped(v[0])}
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
