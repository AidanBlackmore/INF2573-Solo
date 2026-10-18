export function KnifeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      {/* Blade: straight spine, curved edge, tip at the top right. */}
      <path d="M9.5 14.5 21 3c0 5-3.5 10-8.5 13.5z" fill="currentColor" />
      {/* Guard */}
      <path d="M7 12l5 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      {/* Handle */}
      <path d="M8.5 15.5 3.5 20.5" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}
