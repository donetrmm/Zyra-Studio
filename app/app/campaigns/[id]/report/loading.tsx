export default function CampaignReportLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="space-y-2">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-7 w-72 animate-pulse rounded bg-muted" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-10 w-full animate-pulse rounded bg-muted" />
        ))}
      </div>
    </div>
  );
}
