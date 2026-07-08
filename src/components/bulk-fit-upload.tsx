import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { uploadAndParseSessionFile } from "@/lib/session-files.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Upload } from "lucide-react";
import { toast } from "sonner";

/* ------------------------------------------------------------------ */
/* TYPES */
/* ------------------------------------------------------------------ */

type FileStatus =
  | { name: string; state: "queued" }
  | { name: string; state: "uploading" }
  | { name: string; state: "done"; points: number }
  | { name: string; state: "error"; message: string };

/* ------------------------------------------------------------------ */
/* HELPERS */
/* ------------------------------------------------------------------ */

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();

    r.onload = () => {
      const s = String(r.result || "");
      const idx = s.indexOf(",");
      resolve(idx >= 0 ? s.slice(idx + 1) : s);
    };

    r.onerror = () => reject(r.error);

    r.readAsDataURL(file);
  });
}

/* ------------------------------------------------------------------ */
/* COMPONENT */
/* ------------------------------------------------------------------ */

export function BulkFitUpload({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const upload = useServerFn(uploadAndParseSessionFile);

  const [busy, setBusy] = useState(false);
  const [statuses, setStatuses] = useState<FileStatus[]>([]);

  /* ================================================================ */
  /* HANDLE UPLOAD */
  /* ================================================================ */

  async function handle(files: FileList | null) {
    if (!files || !files.length) return;

    setBusy(true);

    const list = Array.from(files);

    setStatuses(
      list.map((f) => ({
        name: f.name,
        state: "queued",
      })),
    );

    for (let i = 0; i < list.length; i++) {
      const f = list[i];

      const kind: "fit" | "gpx" = f.name.toLowerCase().endsWith(".gpx") ? "gpx" : "fit";

      setStatuses((s) =>
        s.map((x, idx) =>
          idx === i
            ? {
                name: f.name,
                state: "uploading",
              }
            : x,
        ),
      );

      try {
        const base64 = await fileToBase64(f);

        const res: any = await upload({
          data: {
            athleteId,
            filename: f.name,
            kind,
            fileBase64: base64,
          },
        });

        if (res?.error) {
          throw new Error(res.error);
        }

        setStatuses((s) =>
          s.map((x, idx) =>
            idx === i
              ? {
                  name: f.name,
                  state: "done",
                  points: res?.points ?? 0,
                }
              : x,
          ),
        );
      } catch (e: any) {
        setStatuses((s) =>
          s.map((x, idx) =>
            idx === i
              ? {
                  name: f.name,
                  state: "error",
                  message: e?.message ?? "Failed",
                }
              : x,
          ),
        );
      }
    }

    setBusy(false);

    qc.invalidateQueries({
      queryKey: ["sessions-list"],
    });

    toast.success("Bulk upload complete");
  }

  /* ------------------------------------------------------------------ */
  /* UI */
  /* ------------------------------------------------------------------ */

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-4 w-4" />
          Bulk upload FIT / GPX
        </CardTitle>

        <CardDescription>
          Files recorded close together (e.g. separate Warm Up / Work / Cool Down / Strides files, or a watch that
          paused mid-session) are automatically merged into one session. Files more than 3 hours apart on the same day —
          like an AM and a PM session — are kept as separate sessions.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <input
          type="file"
          multiple
          accept=".fit,.gpx"
          disabled={busy}
          onChange={(e) => handle(e.currentTarget.files)}
        />

        <ul className="text-xs space-y-1">
          {statuses.map((s, i) => (
            <li key={i}>
              {s.name} — {s.state === "done" ? `${s.points} points` : s.state === "error" ? s.message : s.state}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
