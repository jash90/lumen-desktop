/** Placeholder block shaped like the content it stands in for (PRD §7). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-line ${className}`} />;
}
