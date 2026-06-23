import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { uploadAndParseSessionFile } from "@/lib/session-files.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Upload, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";

type FileStatus =
  | { name: string; state: "queued" }
  | { name: string; state: "uploading" }
  | { name: string; state: "done"; points: number }
  | { name: string; state: "error"; message: string };

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

export function BulkFitUpload({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const upload = useServerFn(uploadAndParseSessionFile);
  const [busy, setBusy] = useState(false);
  const [statuses, setStatuses] = useState<FileStatus[]>([]);

  async function handle(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true);
    const list = Array.from(files);
    setStatuses(list.map((f) => ({ name: f.name, state: "queued" })));

    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const kind: "fit" | "gpx" = f.name.toLowerCase().endsWith(".gpx") ? "gpx" : "fit";
      setStatuses((s) => s.map((x, idx) => (idx === i ? { name: f.name, state: "uploading" } : x)));
      try {
        // Create stub session row
        const { data: sess, error } = await supabase.from("sessions").insert({
          athlete_id: athleteId,
          session_date: new Date().toISOString().slice(0, 10),
          title: f.name.replace(/\.(fit|gpx)$/i, ""),
          day_type: "training" as any,
          intent: "aerobic" as any,
          structure: "continuous" as any,
          is_planned: false,
          completed_at: new Date().toISOString(),
        } as any).select().single();
        if (error || !sess) throw new Error(error?.message ?? "Failed to create session");
        const base64 = await fileToBase64(f);
        const res: any = await upload({ data: { athleteId, sessionId: sess.id, filename: f.name, kind, fileBase64: base64 } });
        setStatuses((s) => s.map((x, idx) => (idx === i ? { name: f.name, state: "done", points: res?.points ?? 0 } : x)));
      } catch (e: any) {
        setStatuses((s) => s.map((x, idx) => (idx === i ? { name: f.name, state: "error", message: e?.message ?? "Failed" } : x)));
      }
    }
    setBusy(false);
    qc.invalidateQueries({ queryKey: ["sessions-list"] });
    toast.success("Bulk upload complete");
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><Upload className="h-4 w-4" /> Bulk upload FIT / GPX</CardTitle>
        <CardDescription>Drops each file into a new completed session. Existing sessions are not modified.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          type="file"
          multiple
          accept=".fit,.gpx"
          disabled={busy}
          onChange={(e) => handle(e.currentTarget.files)}
          className="block w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-secondary file:text-foreground"
        />
        {statuses.length > 0 && (
          <ul className="text-xs space-y-1 max-h-48 overflow-auto">
            {statuses.map((s, i) => (
              <li key={i} className="flex items-center gap-2">
                {s.state === "done" && <Check className="h-3 w-3 text-emerald-600 shrink-0" />}
                {s.state === "error" && <AlertCircle className="h-3 w-3 text-red-600 shrink-0" />}
                <span className="truncate flex-1">{s.name}</span>
                <span className="text-muted-foreground shrink-0">
                  {s.state === "uploading" && "Uploading…"}
                  {s.state === "queued" && "Queued"}
                  {s.state === "done" && `${s.points} points`}
                  {s.state === "error" && s.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}