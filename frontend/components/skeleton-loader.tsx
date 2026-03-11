export function SkeletonCard() {
  return (
    <div className="card animate-pulse">
      <div className="space-y-3">
        <div className="h-3 bg-border rounded w-24" />
        <div className="h-6 bg-border rounded w-16" />
        <div className="h-3 bg-muted rounded w-20" />
      </div>
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="card animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-4 bg-border rounded w-48" />
          <div className="h-3 bg-muted rounded w-64" />
        </div>
        <div className="h-3 bg-muted rounded w-20" />
      </div>
    </div>
  );
}

export function SkeletonPage({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {[...Array(rows)].map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}
