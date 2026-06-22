import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pin, Trash2, ExternalLink, Megaphone, Trophy, CalendarDays, MapPin, BookOpen, Pencil } from "lucide-react";
import { listPosts, createPost, deletePost, toggleReaction, updatePost } from "@/lib/noticeboard.functions";
import { useMyRoles, useAuthUser } from "@/lib/use-auth";
import { format } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/app/noticeboard")({
  component: () => <AppShell><Noticeboard /></AppShell>,
  errorComponent: ({ error }) => <AppShell><p className="text-sm text-destructive">{String(error)}</p></AppShell>,
  notFoundComponent: () => <AppShell><p>Not found</p></AppShell>,
});

const TYPE_META: Record<string, { label: string; icon: any; cls: string }> = {
  announcement:   { label: "Announcement", icon: Megaphone,    cls: "bg-blue-500/15 text-blue-400" },
  result:         { label: "Result",       icon: Trophy,       cls: "bg-amber-500/15 text-amber-400" },
  upcoming_race:  { label: "Upcoming race",icon: CalendarDays, cls: "bg-emerald-500/15 text-emerald-400" },
  training_event: { label: "Training",     icon: MapPin,       cls: "bg-purple-500/15 text-purple-400" },
  birthday:       { label: "Birthday",     icon: Trophy,       cls: "bg-pink-500/15 text-pink-400" },
  resource:       { label: "Resource",     icon: BookOpen,     cls: "bg-slate-500/15 text-slate-300" },
};

const EMOJIS = ["👍", "🔥", "👏", "💪", "🎉"];

function Noticeboard() {
  const list = useServerFn(listPosts);
  const create = useServerFn(createPost);
  const del = useServerFn(deletePost);
  const react = useServerFn(toggleReaction);
  const update = useServerFn(updatePost);
  const qc = useQueryClient();
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach") || roles.includes("manager");

  const { data: posts = [] } = useQuery({ queryKey: ["noticeboard"], queryFn: () => list() });
  const [filter, setFilter] = useState<string>("all");
  const [editing, setEditing] = useState<any | null>(null);

  const reactM = useMutation({
    mutationFn: (v: { post_id: string; emoji: string }) => react({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["noticeboard"] }),
  });
  const delM = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["noticeboard"] }); toast.success("Post removed"); },
  });

  const visible = filter === "all" ? posts : posts.filter((p: any) => p.post_type === filter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Noticeboard</h1>
          <p className="text-sm text-muted-foreground">Squad announcements, results, and upcoming events.</p>
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All posts</SelectItem>
            {Object.entries(TYPE_META).map(([k, m]) => (
              <SelectItem key={k} value={k}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isCoach && <Composer onCreated={() => qc.invalidateQueries({ queryKey: ["noticeboard"] })} createFn={create} />}

      {editing && (
        <Composer
          key={editing.id}
          initial={editing}
          onCreated={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["noticeboard"] }); }}
          onCancel={() => setEditing(null)}
          createFn={create}
          updateFn={update}
        />
      )}

      <div className="space-y-3">
        {visible.length === 0 && <p className="text-sm text-muted-foreground">No posts yet.</p>}
        {visible.map((p: any) => {
          const meta = TYPE_META[p.post_type] ?? TYPE_META.announcement;
          const Icon = meta.icon;
          const groupedReactions = (p.reactions ?? []).reduce((acc: any, r: any) => {
            acc[r.emoji] = (acc[r.emoji] ?? 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          const myReactions = new Set((p.reactions ?? []).filter((r: any) => r.user_id === user?.id).map((r: any) => r.emoji));
          return (
            <Card key={p.id} className={p.pinned ? "border-[var(--accent-red)]/60" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`h-7 w-7 rounded-md grid place-items-center ${meta.cls}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate flex items-center gap-2">
                        {p.pinned && <Pin className="h-3.5 w-3.5 text-[var(--accent-red)]" />}
                        {p.title}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">
                        {p.author_name} · {format(new Date(p.created_at), "MMM d, h:mm a")}
                        {p.event_date && ` · event ${format(new Date(p.event_date), "MMM d")}`}
                        {p.edited_at && ` · edited ${format(new Date(p.edited_at), "MMM d, h:mm a")}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-[10px]">{meta.label}</Badge>
                    {p.author_id === user?.id && (
                      <>
                        {p.post_type !== "birthday" && (
                          <Button variant="ghost" size="icon" onClick={() => setEditing(p)} aria-label="Edit post">
                            <Pencil className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        )}
                      <Button variant="ghost" size="icon" onClick={() => delM.mutate(p.id)}>
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {p.body && <p className="text-sm whitespace-pre-wrap">{p.body}</p>}
                {p.link_url && (
                  <a href={p.link_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-[var(--accent-red)] hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" /> {p.link_url}
                  </a>
                )}
                <div className="flex gap-1 flex-wrap">
                  {EMOJIS.map((e) => (
                    <button
                      key={e}
                      onClick={() => reactM.mutate({ post_id: p.id, emoji: e })}
                      className={`text-xs px-2 py-1 rounded-full border transition ${
                        myReactions.has(e) ? "bg-[var(--accent-red)]/15 border-[var(--accent-red)]/40" : "border-border hover:bg-muted/60"
                      }`}
                    >
                      <span className="mr-1">{e}</span>
                      {groupedReactions[e] ?? 0}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Composer({ onCreated, createFn }: { onCreated: () => void; createFn: any }) {
  const [open, setOpen] = useState(false);
  const [postType, setPostType] = useState<any>("announcement");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [pinned, setPinned] = useState(false);

  const m = useMutation({
    mutationFn: () => createFn({ data: { post_type: postType, title, body: body || undefined, link_url: link || undefined, event_date: eventDate || undefined, pinned } }),
    onSuccess: () => {
      toast.success("Posted to noticeboard");
      setTitle(""); setBody(""); setLink(""); setEventDate(""); setPinned(false); setOpen(false);
      onCreated();
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  if (!open) return (
    <Card>
      <CardContent className="py-3"><Button variant="outline" onClick={() => setOpen(true)}>New post</Button></CardContent>
    </Card>
  );

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">New post</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={postType} onValueChange={setPostType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TYPE_META).filter(([k]) => k !== "birthday").map(([k, m]) => (
                  <SelectItem key={k} value={k}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Event date (optional)</Label>
            <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          </div>
        </div>
        <div>
          <Label className="text-xs">Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Body</Label>
          <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Link (optional)</Label>
          <Input placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin to top
        </label>
        <div className="flex gap-2">
          <Button onClick={() => m.mutate()} disabled={!title.trim() || m.isPending}>Post</Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}