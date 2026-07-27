import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";
import { listRecentReviewsForCoach } from "@/lib/ai-reviews.functions";
import { UserAvatar } from "@/components/user-avatar";

const TYPE_LABEL: Record<string, string> = {
  weekly: "Weekly", monthly: "Monthly", phase: "Completed Phase", yearly: "Yearly", custom: "Custom",
};

// Was "Recent Reviews" — renamed to pair it with the Reports area
// (Metrics bucket in the sidebar) rather than reading as AI-reviews-only,
// with a "View all" link through to the Reports page itself.
export function RecentReviewsCard() {
  const list = useServerFn(listRecentReviewsForCoach);
  const { data = [] } = useQuery({ queryKey: ["recent-reviews"], queryFn: () => list() });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4 text-[var(--accent-red)]" /> Reports and Reviews
        </CardTitle>
        <Button asChild size="sm" variant="ghost">
          <Link to="/app/reports">View all</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Generate a review from any athlete's profile page.</p>
        ) : (
          <div className="divide-y">
            {data.map((r: any) => (
              <Link key={r.id} to="/app/athletes/$athleteId" params={{ athleteId: r.athlete_id }}
                className="flex items-center justify-between py-2 hover:bg-accent/40 rounded px-2 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <UserAvatar name={r.athletes?.name} imageUrl={r.athletes?.profile_image_url} size="sm" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{r.athletes?.name ?? "Athlete"}</div>
                    <div className="text-xs text-muted-foreground">{TYPE_LABEL[r.review_type] ?? r.review_type} · {r.created_at?.slice(0, 10)}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
