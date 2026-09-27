const BM_LABELS: Record<string, string> = {
  'BM-1': 'Pre-Stale Listing Alert',
  'BM-2': 'Rate Lock / Close Date Misalignment',
  'BM-3': 'Micro-Neighborhood Divergence',
  'BM-4': 'Portfolio Cohort Pattern',
  'BM-5': 'Internal Portfolio Collision',
};

export function BenchmarkBadge({ bm }: { bm: string }) {
  const tags = bm.match(/BM-\d/g) ?? [];
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map(tag => (
        <span
          key={tag}
          title={BM_LABELS[tag] ?? tag}
          className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-indigo-900 text-white cursor-default"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}
