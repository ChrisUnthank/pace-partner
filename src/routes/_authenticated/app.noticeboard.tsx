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

  const visible =
    filter === "all"
      ? posts
      : posts.filter((p: any) => p.post_type === filter);

  return (
    <AppShell>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* ✅ LEFT: POSTS */}
        <div className="xl:col-span-2 space-y-4">

          <h1 className="text-2xl font-bold">Noticeboard</h1>

          {/* ✅ FILTER */}
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" onClick={() => setFilter("all")}>
              All
            </Button>

            {Object.entries(TYPE_META).map(([key, m]) => (
              <Button
                key={key}
                size="sm"
                variant={filter === key ? "default" : "outline"}
                onClick={() => setFilter(key)}
              >
                {m.label}
              </Button>
            ))}
          </div>

          {/* ✅ COMPOSER */}
          {isCoach && (
            <Composer
              onCreated={() =>
                qc.invalidateQueries({ queryKey: ["noticeboard"] })
              }
              createFn={create}
            />
          )}

          {/* ✅ POSTS */}
          {visible.map((p: any) => (
            <Card key={p.id}>
              <CardContent className="pt-4 space-y-2">

                <div className="flex justify-between">
                  <div className="font-semibold">{p.title}</div>
                  {p.pinned && (
                    <span className="text-xs text-amber-500">Pinned</span>
                  )}
                </div>

                <div className="text-xs text-muted-foreground">
                  {p.author_name}
                </div>

                {p.body && (
                  <p className="text-sm text-muted-foreground">
                    {p.body}
                  </p>
                )}

                {p.link_url && (
                  <a
                    href={p.link_url}
                    target="_blank"
                    className="text-blue-500 underline text-sm"
                  >
                    Open link
                  </a>
                )}

              </CardContent>
            </Card>
          ))}

        </div>

        {/* ✅ RIGHT SIDEBAR */}
        <div className="space-y-4">

          <InstagramPanel />

          <MediaPanel />

        </div>

      </div>
    </AppShell>
  );
}
function InstagramPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Instagram</CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">

        <p className="text-sm text-muted-foreground">
          Follow team updates
        </p>

        https://instagram.com/YOUR_ACCOUNT
          Open Instagram →
        </a>

        {/* OPTIONAL EMBED */}
        https://www.instagram.com/p/CODE/embed

      </CardContent>
    </Card>
  );
}
function MediaPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Team Media</CardTitle>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-3 gap-2">

          {[1,2,3,4,5,6].map((i) => (
            <div
              key={i}
              className="aspect-square bg-muted rounded flex items-center justify-center text-xs text-muted-foreground"
            >
              Img
            </div>
          ))}

        </div>
      </CardContent>
    </Card>
  );
}
