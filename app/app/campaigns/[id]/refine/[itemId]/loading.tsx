export default function RefineLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="space-y-2">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-7 w-64 animate-pulse rounded bg-muted" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-12 w-full animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
        <div className="aspect-[9/16] w-full animate-pulse rounded-lg bg-muted" />
      </div>
    </div>
  );
}
