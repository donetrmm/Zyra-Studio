export default function LibraryLoading() {
  return (
    <div className="flex min-h-[50vh] flex-col bg-background">
      <div className="border-b border-border px-4 py-4 sm:px-6">
        <div className="h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-2 flex gap-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-8 w-20 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      </div>
      <div className="flex-1 px-4 pt-4 sm:px-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    </div>
  );
}
