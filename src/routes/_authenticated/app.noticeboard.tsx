// ✅ SAME IMPORTS (UNCHANGED)
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
import { UserAvatar } from "@/components/user-avatar";

export const Route = createFileRoute("/_authenticated/app/noticeboard")({
  component: () => <AppShell><Noticeboard /></AppShell>,
});

// ✅ KEEP YOUR EXISTING META
const TYPE_META = {
  announcement:{label:"Announcement",icon:Megaphone,cls:"bg-blue-500/15 text-blue-400"},
  result:{label:"Result",icon:Trophy,cls:"bg-amber-500/15 text-amber-400"},
  upcoming_race:{label:"Upcoming race",icon:CalendarDays,cls:"bg-emerald-500/15 text-emerald-400"},
  training_event:{label:"Training",icon:MapPin,cls:"bg-purple-500/15 text-purple-400"},
  resource:{label:"Resource",icon:BookOpen,cls:"bg-slate-500/15 text-slate-300"},
};

const EMOJIS = ["👍","🔥","👏","💪","🎉"];

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

  const { data: posts = [] } = useQuery({
    queryKey: ["noticeboard"],
    queryFn: () => list(),
  });

  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<any | null>(null);

  const reactM = useMutation({
    mutationFn: (v:any)=>react({data:v}),
    onSuccess:()=>qc.invalidateQueries({queryKey:["noticeboard"]})
  });

  const delM = useMutation({
    mutationFn:(id:string)=>del({data:{id}}),
    onSuccess:()=>qc.invalidateQueries({queryKey:["noticeboard"]})
  });

  const visible = filter==="all"
    ? posts
    : posts.filter((p:any)=>p.post_type===filter);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

      {/* ✅ LEFT COLUMN (MAIN CONTENT) */}
      <div className="xl:col-span-2 space-y-4">

        {/* HEADER */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Noticeboard</h1>
            <p className="text-sm text-muted-foreground">
              Squad announcements and updates
            </p>
          </div>

          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {Object.entries(TYPE_META).map(([k,m])=>(
                <SelectItem key={k} value={k}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* COMPOSER */}
        {isCoach && (
          <Composer
            onCreated={()=>qc.invalidateQueries({queryKey:["noticeboard"]})}
            createFn={create}
          />
        )}

        {/* POSTS */}
        {visible.map((p:any)=>{

          const meta = TYPE_META[p.post_type] || TYPE_META.announcement;
          const Icon = meta.icon;

          return (
            <Card key={p.id}>
              <CardHeader className="pb-2">

                <div className="flex justify-between">

                  <div className="flex gap-2 items-center">
                    <Icon className="h-4 w-4"/>
                    <h3 className="font-semibold">{p.title}</h3>
                    {p.pinned && <Pin className="h-3 text-red-500"/>}
                  </div>

                  {/* ACTIONS */}
                  {p.author_id===user?.id && (
                    <div className="flex gap-2">
                      <Button size="icon" variant="ghost" onClick={()=>setEditing(p)}>
                        <Pencil size={14}/>
                      </Button>
                      <Button size="icon" variant="ghost" onClick={()=>delM.mutate(p.id)}>
                        <Trash2 size={14}/>
                      </Button>
                    </div>
                  )}

                </div>

                <p className="text-xs text-muted-foreground">
                  {p.author_name} · {format(new Date(p.created_at),"MMM d")}
                </p>

              </CardHeader>

              <CardContent className="space-y-2">

                {p.body && <p className="text-sm">{p.body}</p>}

                {p.link_url && (
                  <a href={p.link_url} target="_blank" className="text-sm text-blue-500 underline flex items-center gap-1">
                    <ExternalLink size={12}/>
                    Link
                  </a>
                )}

                {/* REACTIONS */}
                <div className="flex gap-1 flex-wrap">
                  {EMOJIS.map(e=>(
                    <button
                      key={e}
                      onClick={()=>reactM.mutate({post_id:p.id,emoji:e})}
                      className="text-xs px-2 py-1 border rounded"
                    >
                      {e}
                    </button>
                  ))}
                </div>

              </CardContent>
            </Card>
          );

        })}

      </div>

      {/* ✅ RIGHT SIDEBAR */}
      <div className="space-y-4">

        {/* INSTAGRAM */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Instagram</CardTitle>
          </CardHeader>
          <CardContent>
            https://instagram.com/YOUR_ACCOUNT
              View Instagram →
            </a>
          </CardContent>
        </Card>

        {/* MEDIA */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Team Media</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2">
              {[1,2,3,4,5,6].map(i=>(
                <div key={i} className="aspect-square bg-muted rounded flex items-center justify-center text-xs">
                  Img
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}

/* ✅ KEEP YOUR EXISTING COMPOSER BELOW (UNCHANGED) */

function Composer({ onCreated, onCancel, createFn, updateFn, initial }: { onCreated: () => void; onCancel?: () => void; createFn: any; updateFn?: any; initial?: any }) {
  const isEdit = !!initial;
  const [open, setOpen] = useState(isEdit);
  const [postType, setPostType] = useState<any>(initial?.post_type ?? "announcement");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [link, setLink] = useState(initial?.link_url ?? "");
  const [eventDate, setEventDate] = useState(initial?.event_date ?? "");
  const [pinned, setPinned] = useState(!!initial?.pinned);

  const m = useMutation({
    mutationFn: () => isEdit
      ? updateFn({ data: { id: initial.id, post_type: postType, title, body: body || null, link_url: link || null, event_date: eventDate || null, pinned } })
      : createFn({ data: { post_type: postType, title, body: body || undefined, link_url: link || undefined, event_date: eventDate || undefined, pinned } }),
    onSuccess: () => {
      toast.success(isEdit ? "Post updated" : "Posted to noticeboard");
      if (!isEdit) { setTitle(""); setBody(""); setLink(""); setEventDate(""); setPinned(false); setOpen(false); }
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
      <CardHeader><CardTitle className="text-base">{isEdit ? "Edit post" : "New post"}</CardTitle></CardHeader>
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
          <Button onClick={() => m.mutate()} disabled={!title.trim() || m.isPending}>{isEdit ? "Save" : "Post"}</Button>
          <Button variant="ghost" onClick={() => { setOpen(false); onCancel?.(); }}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}