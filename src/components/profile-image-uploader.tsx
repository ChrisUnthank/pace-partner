import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { toast } from "sonner";
import { Upload } from "lucide-react";

const MAX_BYTES = 5 * 1024 * 1024;
const TARGET = 400;

async function fileToSquareJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = url;
    });
    const side = Math.min(img.width, img.height);
    const sx = (img.width - side) / 2;
    const sy = (img.height - side) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = TARGET; canvas.height = TARGET;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, sx, sy, side, side, 0, 0, TARGET, TARGET);
    return await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("Encoding failed"))), "image/jpeg", 0.9),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ProfileImageUploader({ userId, name }: { userId: string; name: string }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);

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
      const blob = await fileToSquareJpeg(f);
      setPreviewBlob(blob);
      setPreview(URL.createObjectURL(blob));
    } catch (err: any) {
      toast.error(err.message ?? "Could not read image");
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
      setPreview(null); setPreviewBlob(null);
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
        <CardDescription>JPG, PNG, or WebP up to 5MB. Cropped to a square.</CardDescription>
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
                <Button size="sm" variant="ghost" onClick={() => { setPreview(null); setPreviewBlob(null); }}>Cancel</Button>
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
    </Card>
  );
}