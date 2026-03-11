/** Relative time string from ISO date or timestamp */
export function timeAgo(date: string | number | Date): string {
  const d = Date.now() - new Date(date).getTime();
  if (d < 0) return "soon";
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}
