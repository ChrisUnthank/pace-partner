import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { uploadAndParseSessionFile } from "@/lib/session-files.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Upload } from "lucide-react";
import { toast } from "sonner";

/* ------------------------------------------------------------------ */
/* TYPES                                                              */
/* ------------------------------------------------------------------ */

type FileStatus =
  | { name: string; state: "queued" }
  | { name: string; state: "uploading" }
  | { name: string; state: "done"; points: number }
  | { name: string; state: "error"; message: string };

/* ------------------------------------------------------------------ */
/* HELPERS                                                           */
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
/* COMPONENT                                                         */
/* ------------------------------------------------------------------ */

export function BulkFitUpload({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const upload = useServerFn(uploadAndParseSessionFile);

  const [busy, setBusy] = useState(false);
  const [statuses, setStatuses] = useState<FileStatus[]>([]);

  /* ================================================================ */
  /* HANDLE UPLOAD                                                   */
  /* ================================================================ */

  async function handle(files: FileList | null) {
    if (!files || !files.length) return;

    setBusy(true);

    const list = Array.from(files);
    setStatuses(list.map((f) => ({ name: f.name, state: "queued" })));

    /* ---------------- AUTH CHECK ---------------- */
    const { data, error: userError } = await supabase.auth.getUser();

    const user = data?.user ?? null;

    if (userError || !user?.id) {
      setBusy(false);
      throw new Error("Not authenticated");
    }

    /* ---------------- FILE LOOP ---------------- */
    for (let i = 0; i < list.length; i++) {
      const f = list[i];

      const kind: "fit" | "gpx" = f.name.toLowerCase().endsWith(".gpx") ? "gpx" : "fit";

      /* mark uploading */
      setStatuses((s) => s.map((x, idx) => (idx === i ? { name: f.name, state: "uploading" } : x)));

      try {
        /* ---------------- CREATE SESSION ---------------- */
        const { data: sess, error } = await supabase
          .from("sessions")
          .insert({
            athlete_id: athleteId,
            created_by: user.id,
            session_date: new Date().toISOString().slice(0, 10),
            title: f.name.replace(/\.(fit|gpx)$/i, ""),
            day_type: "training" as any,
            intent: "aerobic" as any,
            structure: "continuous" as any,
            is_planned: false,
            completed_at: new Date().toISOString(),
            source: "fit_import",
            data_source: "fit",
            activity_type: "run",
          } as any)
          .select()
          .single();

        if (error || !sess) {
          throw new Error(error?.message ?? "Failed to create session");
        }

        /* ---------------- FILE PROCESSING ---------------- */
        const base64 = await fileToBase64(f);

        const res: any = await upload({
          data: {
            athleteId,
            sessionId: sess.id,
            filename: f.name,
            kind,
            fileBase64: base64,
          },
        });

        /* ---------------- SUCCESS STATE ---------------- */
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
        /* ---------------- ERROR STATE ---------------- */
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
    } // ✅ END LOOP

    /* ---------------- FINALISE ---------------- */
    setBusy(false);
    qc.invalidateQueries({ queryKey: ["sessions-list"] });
    toast.success("Bulk upload complete");
  }

  /* ------------------------------------------------------------------ */
  /* RENDER                                                           */
  /* ------------------------------------------------------------------ */

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-4 w-4" />
          Bulk upload FIT / GPX
        </CardTitle>
        <CardDescription>Drops each file into a new completed session.</CardDescription>
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
              {s.name} — {s.state}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
