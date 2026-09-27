import type { VerticalConfig } from '@/lib/vertical/verticalTypes';

interface Institution {
  id: string;
  name: string;
  slug?: string | null;
  tier?: string | null;
}

interface TierCounts {
  CRITICAL: number;
  ALERT: number;
  CAUTION: number;
  STABLE: number;
}

interface Props {
  institution: Institution;
  tiers: TierCounts;
  config: VerticalConfig;
  lastSweepAt?: string | null;
  listingCount?: number;
  buyerCount?: number;
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function VerticalReportHeader({
  institution, tiers, config, lastSweepAt, listingCount = 0, buyerCount = 0,
}: Props) {
  const vertical = config.vertical_type === 'real_estate' ? 'Real Estate Portfolio' : config.vertical_type;

  return (
    <div style={{ background: '#F0F3F8', fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <div style={{ background: '#1B2A4A', padding: '18px 32px 0' }}>
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', paddingBottom: 16 }}>
          <div>
            <div style={{ color: 'white', fontSize: 20, fontWeight: 700 }}>{institution.name}</div>
            <div style={{ color: '#C8A84B', fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 2 }}>
              Meridian Fusion · {vertical}
            </div>
          </div>
          {lastSweepAt && (
            <div style={{ color: '#8899BB', fontSize: 11, textAlign: 'right' }}>
              Last sweep<br />
              <span style={{ color: 'white', fontWeight: 600 }}>{fmtDateTime(lastSweepAt)}</span>
            </div>
          )}
        </div>

        {/* Tier summary bar */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: '#0f1e38' }}>
          {(['CRITICAL', 'ALERT', 'CAUTION', 'STABLE'] as const).map(tier => (
            <div key={tier} style={{ background: '#1B2A4A', padding: '12px 16px', textAlign: 'center' }}>
              <div style={{
                fontSize: 32, fontWeight: 900, lineHeight: 1,
                color: tier === 'CRITICAL' ? '#ef4444' : tier === 'ALERT' ? '#f97316' : tier === 'CAUTION' ? '#f59e0b' : '#10b981',
              }}>
                {tiers[tier]}
              </div>
              <div style={{
                fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 4,
                color: tier === 'CRITICAL' ? '#ef4444' : tier === 'ALERT' ? '#f97316' : tier === 'CAUTION' ? '#f59e0b' : '#10b981',
              }}>
                {tier}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Active listings vs buyers (real_estate only) */}
      {config.vertical_type === 'real_estate' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', background: 'white', borderBottom: '1px solid #DDE3EE' }}>
          <div style={{ padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 12, borderRight: '1px solid #DDE3EE' }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: '#1B2A4A' }}>{listingCount}</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#1B2A4A' }}>Active Listings</div>
              <div style={{ fontSize: 10, color: '#6B7280' }}>In-scope cases</div>
            </div>
          </div>
          <div style={{ padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: '#1B2A4A' }}>{buyerCount}</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#1B2A4A' }}>Active Buyers</div>
              <div style={{ fontSize: 10, color: '#6B7280' }}>In-scope cases</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
