import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { X, Upload } from "lucide-react";

const BUCKET = "coach-media";

async function uploadFile(userId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export function SingleImageUpload({
  userId,
  value,
  onChange,
  label = "image",
  aspect = "aspect-video",
}: {
  userId: string;
  value?: string;
  onChange: (url: string) => void;
  label?: string;
  aspect?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const url = await uploadFile(userId, file);
      onChange(url);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {value ? (
        <div className={`relative w-full overflow-hidden rounded-md border ${aspect}`}>
          <img src={value} alt={label} className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <div className={`flex w-full items-center justify-center rounded-md border border-dashed ${aspect}`}>
          <span className="text-xs text-muted-foreground">No {label}</span>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
        <Upload className="mr-2 h-3 w-3" />
        {busy ? "Uploading…" : `Upload ${label}`}
      </Button>
    </div>
  );
}

export function MultiImageUpload({
  userId,
  values,
  onChange,
}: {
  userId: string;
  values: string[];
  onChange: (urls: string[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFiles(files: FileList) {
    setBusy(true);
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files)) {
        uploaded.push(await uploadFile(userId, file));
      }
      onChange([...values, ...uploaded]);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {values.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {values.map((url, i) => (
            <div key={url + i} className="relative aspect-square overflow-hidden rounded-md border">
              <img src={url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => onChange(values.filter((_, idx) => idx !== i))}
                className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
        <Upload className="mr-2 h-3 w-3" />
        {busy ? "Uploading…" : "Add images"}
      </Button>
    </div>
  );
}