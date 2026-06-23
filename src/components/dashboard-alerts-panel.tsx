import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import {
  listDashboardAlerts,
  dismissAlert,
  markSessionRestDay,
  markSessionSkipped,
  type DashAlert,
} from "@/lib/dashboard-alerts.functions";
import { AlertTriangle, X, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";

const SEV_BORDER: Record<DashAlert["severity"], string> = {
  critical: "border-l-[#EF4444]",
  warning: "border-l-[#F59E0B]",
  info: "border-l-[#38BDF8]",
};
const SEV_BADGE: Record<DashAlert["severity"], string> = {
  critical: "bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30",
  warning: "bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/30",
  info: "bg-[#38BDF8]/15 text-[#38BDF8] border-[#38BDF8]/30",
};

export function DashboardAlertsPanel() {
  const listFn = useServerFn(listDashboardAlerts);
  const dismissFn = useServerFn(dismissAlert);
  const restFn = useServerFn(markSessionRestDay);
  const skipFn = useServerFn(markSessionSkipped);
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState<boolean | null>(null);

  const { data: alerts = [] as DashAlert[], isLoading } = useQuery({
    queryKey: ["dashboard-alerts"],
    queryFn: () => listFn(),
  });

  const dismissM = useMutation({
    mutationFn: (v: { athleteId: string; alertType: string }) => dismissFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard-alerts"] }),
  });
  const restM = useMutation({
    mutationFn: (sessionId: string) => restFn({ data: { sessionId } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["dashboard-alerts"] }); toast.success("Marked as rest day"); },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });
  const skipM = useMutation({
    mutationFn: (sessionId: string) => skipFn({ data: { sessionId } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["dashboard-alerts"] }); toast.success("Marked as skipped"); },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  if (isLoading) return null;

  const isCollapsed = collapsed ?? !!isMobile;

  if (!alerts.length) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            Needs Attention
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">All athletes on track today. ✨</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          className="w-full flex items-center justify-between"
          onClick={() => setCollapsed(!isCollapsed)}
        >
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-[#F59E0B]" />
            Needs Attention
            <Badge variant="secondary" className="ml-1">{alerts.length}</Badge>
          </CardTitle>
          {isCollapsed ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
        </button>
      </CardHeader>
      {!isCollapsed && (
        <CardContent className="space-y-2.5">
          {(alerts as DashAlert[]).map((a) => (
            <div
              key={`${a.athlete_id}-${a.alert_type}`}
              className={`border border-border border-l-4 ${SEV_BORDER[a.severity]} bg-card rounded-md p-3`}
            >
              <div className="flex items-start gap-3">
                <UserAvatar name={a.athlete_name} imageUrl={a.athlete_image_url} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{a.athlete_name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wide ${SEV_BADGE[a.severity]}`}>
                          {a.severity}
                        </span>
                      </div>
                      <p className="text-sm font-medium mt-0.5">{a.title}</p>
                      <p className="text-xs text-muted-foreground">{a.trigger}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => dismissM.mutate({ athleteId: a.athlete_id, alertType: a.alert_type })}
                      aria-label="Dismiss alert"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <p className="text-xs text-foreground/80 mt-1.5">{a.guidance}</p>
                  {a.extra?.note && (
                    <p className="text-xs italic text-muted-foreground mt-1.5 bg-muted/40 rounded px-2 py-1.5">
                      "{a.extra.note}"
                    </p>
                  )}
                  {a.actions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {a.actions.map((act: DashAlert["actions"][number], i: number) => {
                        if (act.kind === "link" && act.target) {
                          return (
                            <Button key={i} asChild size="sm" variant="outline" className="h-7 text-xs">
                              <Link to={act.target}>{act.label}</Link>
                            </Button>
                          );
                        }
                        if (act.kind === "rest_day" && act.sessionId) {
                          return (
                            <Button key={i} size="sm" variant="outline" className="h-7 text-xs"
                              onClick={() => restM.mutate(act.sessionId!)}>
                              {act.label}
                            </Button>
                          );
                        }
                        if (act.kind === "skip_session" && act.sessionId) {
                          return (
                            <Button key={i} size="sm" variant="outline" className="h-7 text-xs"
                              onClick={() => skipM.mutate(act.sessionId!)}>
                              {act.label}
                            </Button>
                          );
                        }
                        return null;
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}