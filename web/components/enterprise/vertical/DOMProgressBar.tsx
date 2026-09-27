interface Props {
  daysOnMarket: number;
  threshold?: number;
}

export function DOMProgressBar({ daysOnMarket, threshold = 45 }: Props) {
  const pct = Math.min((daysOnMarket / threshold) * 100, 100);
  const color =
    pct >= 100 ? 'bg-red-500' :
    pct >= 75  ? 'bg-amber-400' :
                 'bg-green-500';

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-500">
        <span>Days on Market</span>
        <span className={pct >= 75 ? 'font-semibold text-amber-600' : ''}>{daysOnMarket}d</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-200">
        <div
          className={`h-1.5 rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
