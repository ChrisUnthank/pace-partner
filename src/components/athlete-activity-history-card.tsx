import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "@tanstack/react-router";
import {
  History,
  Upload,
  Layers,
  Sparkles,
  MessageCircle,
  CalendarRange,
  Send,
  Trophy,
  Medal,
  FileText,
  ChevronRight,
} from "lucide-react";
import { listAthleteActivityHistory, type ActivityEvent, type ActivityEventType } from "@/lib/activity-history.functions";

const PAGE_SIZE = 20;

// Groups the 11 underlying event types into the filter buckets a coach
// actually thinks in — "Sessions" covers logged/uploaded/bulk-uploaded as
// one concept, same for the AI/Messages/Plans buckets, rather than
// exposing every sub-type as its own filter chip.
const FILTER_GROUPS: { key: string; label: string; types: ActivityEventType[] }[] = [
  { key: "sessions", label: "Sessions", types: ["session_logged", "session_uploaded", "sessions_bulk_uploaded"] },
  { key: "races", label: "Races & PBs", types: ["raced", "pb_achieved"] },
  { key: "ai", label: "AI", types: ["ai_generated"] },
  { key: "messages", label: "Messages", types: ["message_sent", "message_received"] },
  { key: "plans", label: "Plans", types: ["plan_built", "plan_sent"] },
  { key: "reports", label: "Reports", types: ["report_generated"] },
];

const TYPE_ICON: Record<ActivityEventType, any> = {
  session_logged: Layers,
  session_uploaded: Upload,
  sessions_bulk_uploaded: Upload,
  ai_generated: Sparkles,
  message_sent: Send,
  message_received: MessageCircle,
  plan_built: CalendarRange,
  plan_sent: Send,
  raced: Trophy,
  pb_achieved: Medal,
  report_generated: FileText,
};

const TYPE_COLOR: Record<ActivityEventType, string> = {
  session_logged: "#94a3b8",
  session_uploaded: "#38bdf8",
  sessions_bulk_uploaded: "#38bdf8",
  ai_generated: "#a78bfa",
  message_sent: "#22c55e",
  message_received: "#22c55e",
  plan_built: "#f97316",
  plan_sent: "#f97316",
  raced: "#ef4444",
  pb_achieved: "#eab308",
  report_generated: "#64748b",
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffS = Math.round((now - then) / 1000);
  if (diffS < 60) return "just now";
  const diffM = Math.round(diffS / 60);
  if (diffM < 60) return `${diffM}m ago`;
  const diffH = Math.round(diffM / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function EventRow({ event }: { event: ActivityEvent }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TYPE_ICON[event.type];
  const color = TYPE_COLOR[event.type];
  const canExpand = !!event.description || !!event.link;

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => canExpand && setExpanded((v) => !v)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left ${canExpand ? "hover:bg-accent/40 cursor-pointer" : "cursor-default"}`}
      >
        <div className="h-7 w-7 shrink-0 rounded-full grid place-items-center" style={{ background: `${color}1a` }}>
          <Icon className="h-3.5 w-3.5" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate">{event.title}</div>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{relativeTime(event.timestamp)}</span>
        {canExpand && (
          <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 pl-[52px] -mt-1 text-xs text-muted-foreground space-y-1">
          {event.description && <p>{event.description}</p>}
          {event.link && (
            <Link to={event.link as any} className="underline hover:text-foreground">
              Open →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

export function AthleteActivityHistoryCard({ athleteId }: { athleteId: string }) {
  const listFn = useServerFn(listAthleteActivityHistory);
  const { data: events = [], isLoading } = useQuery({
    queryKey: ["athlete-activity-history", athleteId],
    enabled: !!athleteId,
    queryFn: () => listFn({ data: { athleteId } }),
  });

  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    if (!activeGroup) return events;
    const group = FILTER_GROUPS.find((g) => g.key === activeGroup);
    if (!group) return events;
    return events.filter((e) => (group.types as string[]).includes(e.type));
  }, [events, activeGroup]);

  const visible = filtered.slice(0, visibleCount);

  function setGroup(key: string | null) {
    setActiveGroup(key);
    setVisibleCount(PAGE_SIZE);
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-[var(--accent-red)]" />
          Activity History
        </CardTitle>
        <CardDescription>Everything logged for this athlete — sessions, AI activity, messages, plans, races, and reports.</CardDescription>
        <div className="flex flex-wrap gap-1.5 pt-2">
          <button
            onClick={() => setGroup(null)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              !activeGroup ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent border-border"
            }`}
          >
            All
          </button>
          {FILTER_GROUPS.map((g) => (
            <button
              key={g.key}
              onClick={() => setGroup(g.key)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                activeGroup === g.key ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent border-border"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <p className="text-sm text-muted-foreground p-4">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground p-4">Nothing logged here yet.</p>
        ) : (
          <>
            <div>
              {visible.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </div>
            {visibleCount < filtered.length && (
              <div className="p-3 border-t border-border">
                <Button size="sm" variant="outline" className="w-full" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>
                  Show {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more
                  <Badge variant="secondary" className="ml-2">{filtered.length - visibleCount} total</Badge>
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
