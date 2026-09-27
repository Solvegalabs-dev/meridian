interface Props {
  rateLockExpires: string; // ISO date string
}

export function RateLockCountdown({ rateLockExpires }: Props) {
  const today = new Date();
  const expires = new Date(rateLockExpires);
  const daysRemaining = Math.ceil((expires.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  const color =
    daysRemaining < 0   ? 'text-red-600 font-bold' :
    daysRemaining < 8   ? 'text-red-500 font-semibold' :
    daysRemaining < 22  ? 'text-amber-500 font-medium' :
                          'text-green-600';

  const pulse = daysRemaining >= 0 && daysRemaining < 8;

  return (
    <div className="flex items-center gap-1.5 text-sm">
      <span className="text-gray-500">Rate Lock:</span>
      <span className={`${color} ${pulse ? 'animate-pulse' : ''}`}>
        {daysRemaining < 0
          ? 'EXPIRED'
          : `${daysRemaining}d remaining`}
      </span>
    </div>
  );
}
