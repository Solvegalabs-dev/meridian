import { SupabaseClient } from '@supabase/supabase-js';

export function buildUrl(
  template: string,
  geoContext: { state?: string; county?: string; domain?: string; objectiveId?: string }
): string {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const minus = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return fmt(d);
  };

  return template
    .replace(/\{state\}/g, geoContext.state ?? 'UT')
    .replace(/\{county\}/g, geoContext.county ?? '')
    .replace(/\{domain\}/g, geoContext.domain ?? '')
    .replace(/\{domain_keyword\}/g, geoContext.domain ?? '')
    .replace(/\{date_today\}/g, fmt(now))
    .replace(/\{date_minus_7\}/g, minus(7))
    .replace(/\{date_minus_30\}/g, minus(30))
    .replace(/\{unix_timestamp\}/g, String(Math.floor(now.getTime() / 1000)))
    .replace(/\{station_id\}/g, 'USC00420072')  // placeholder — FF-071 fills at runtime
    .replace(/\{place_id\}/g, '27')             // Utah iNaturalist place_id
    .replace(/FRED_API_KEY/g, process.env.FRED_API_KEY ?? '')
    .replace(/EIA_API_KEY/g, process.env.EIA_API_KEY ?? '');
}

// Tries to extract a numeric value from common API response shapes.
function extractFirstNumeric(body: unknown): number | null {
  if (typeof body === 'number') return body;

  // FRED-style: { observations: [{ value: "..." }, ...] }
  if (typeof body === 'object' && body !== null) {
    const b = body as Record<string, unknown>;
    if (Array.isArray(b.observations) && b.observations.length > 0) {
      const val = (b.observations[0] as Record<string, unknown>).value;
      const n = parseFloat(String(val));
      if (!isNaN(n)) return n;
    }
    // EIA-style: { response: { data: [{ value: ... }] } }
    if (typeof b.response === 'object' && b.response !== null) {
      const resp = b.response as Record<string, unknown>;
      if (Array.isArray(resp.data) && resp.data.length > 0) {
        const val = (resp.data[0] as Record<string, unknown>).value;
        const n = parseFloat(String(val));
        if (!isNaN(n)) return n;
      }
    }
    // BLS-style: { Results: { series: [{ data: [{ value: "..." }] }] } }
    if (typeof b.Results === 'object' && b.Results !== null) {
      const results = b.Results as Record<string, unknown>;
      if (Array.isArray(results.series) && results.series.length > 0) {
        const series = results.series[0] as Record<string, unknown>;
        if (Array.isArray(series.data) && series.data.length > 0) {
          const val = (series.data[0] as Record<string, unknown>).value;
          const n = parseFloat(String(val));
          if (!isNaN(n)) return n;
        }
      }
    }
    // GeoJSON FeatureCollection (weather.gov station observations):
    // Properties are QualifiedValues: { value: 19.4, unitCode: "wmoUnit:degC", qualityControl: "V" }
    // Skip static station attributes (elevation, stationId) and array fields (presentWeather, cloudLayers).
    if (b.type === 'FeatureCollection' && Array.isArray(b.features) && b.features.length > 0) {
      const props = (b.features[0] as Record<string, unknown>).properties;
      if (typeof props === 'object' && props !== null) {
        for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
          if (k === 'elevation' || k === 'stationId') continue;
          if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
            const qv = (v as Record<string, unknown>).value;
            if (typeof qv === 'number' && !isNaN(qv)) return qv;
          }
        }
      }
    }
    // GeoJSON Feature (weather.gov forecast): periods[0] QualifiedValues come before windSpeed string.
    // Property order: probabilityOfPrecipitation → dewpoint → relativeHumidity → windSpeed (string) → ...
    // Walking QualifiedValues first returns probabilityOfPrecipitation.value for both forecast agents.
    if (b.type === 'Feature' && typeof b.properties === 'object' && b.properties !== null) {
      const props = b.properties as Record<string, unknown>;
      if (Array.isArray(props.periods) && props.periods.length > 0) {
        const period = props.periods[0] as Record<string, unknown>;
        for (const v of Object.values(period)) {
          if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
            const qv = (v as Record<string, unknown>).value;
            if (typeof qv === 'number' && !isNaN(qv)) return qv;
          }
        }
        if (typeof period.temperature === 'number') return period.temperature;
      }
    }

    // USGS waterservices-style: { value: { timeSeries: [{ values: [{ value: [{ value: "..." }] }] }] } }
    if (typeof b.value === 'object' && b.value !== null) {
      const v = b.value as Record<string, unknown>;
      if (Array.isArray(v.timeSeries) && v.timeSeries.length > 0) {
        const ts = v.timeSeries[0] as Record<string, unknown>;
        if (Array.isArray(ts.values) && ts.values.length > 0) {
          const vals = ts.values[0] as Record<string, unknown>;
          if (Array.isArray(vals.value) && vals.value.length > 0) {
            const val = (vals.value[0] as Record<string, unknown>).value;
            const n = parseFloat(String(val));
            if (!isNaN(n)) return n;
          }
        }
      }
    }
  }

  // CSV / plain text — grab first numeric token
  if (typeof body === 'string') {
    const match = body.match(/[-+]?\d+\.?\d*/);
    if (match) return parseFloat(match[0]);
  }

  return null;
}

// Tries to extract a second (prior) numeric value for delta_pct comparison.
function extractSecondNumeric(body: unknown): number | null {
  if (typeof body === 'object' && body !== null) {
    const b = body as Record<string, unknown>;
    if (Array.isArray(b.observations) && b.observations.length > 1) {
      const val = (b.observations[1] as Record<string, unknown>).value;
      const n = parseFloat(String(val));
      if (!isNaN(n)) return n;
    }
    if (typeof b.response === 'object' && b.response !== null) {
      const resp = b.response as Record<string, unknown>;
      if (Array.isArray(resp.data) && resp.data.length > 1) {
        const val = (resp.data[1] as Record<string, unknown>).value;
        const n = parseFloat(String(val));
        if (!isNaN(n)) return n;
      }
    }
    if (b.type === 'FeatureCollection' && Array.isArray(b.features) && b.features.length > 1) {
      const props = (b.features[1] as Record<string, unknown>).properties;
      if (typeof props === 'object' && props !== null) {
        for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
          if (k === 'elevation' || k === 'stationId') continue;
          if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
            const qv = (v as Record<string, unknown>).value;
            if (typeof qv === 'number' && !isNaN(qv)) return qv;
          }
        }
      }
    }
  }
  return null;
}

export function evaluateThreshold(
  body: unknown,
  thresholdType: string,
  thresholdValue: number | null,
  keywords: string[] | null
): { crossed: boolean; observedValue?: number } {
  switch (thresholdType) {
    case 'new_record':
      return { crossed: true };

    case 'keyword_match': {
      if (!keywords || keywords.length === 0) return { crossed: false };
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      const lower = text.toLowerCase();
      const hit = keywords.some(kw => lower.includes(kw.toLowerCase()));
      return { crossed: hit };
    }

    case 'delta_pct': {
      const current = extractFirstNumeric(body);
      const prior = extractSecondNumeric(body);
      if (current === null || prior === null || prior === 0) return { crossed: false, observedValue: current ?? undefined };
      const pctChange = Math.abs((current - prior) / prior) * 100;
      return { crossed: thresholdValue !== null ? pctChange >= thresholdValue : pctChange > 0, observedValue: pctChange };
    }

    case 'value_above': {
      const val = extractFirstNumeric(body);
      if (val === null || thresholdValue === null) return { crossed: false };
      return { crossed: val > thresholdValue, observedValue: val };
    }

    case 'value_below': {
      const val = extractFirstNumeric(body);
      if (val === null || thresholdValue === null) return { crossed: false };
      return { crossed: val < thresholdValue, observedValue: val };
    }

    default:
      return { crossed: false };
  }
}

interface AgentConfig {
  agent_key: string;
  display_name: string;
  event_category: string;
  event_source_prefix: string;
  vertical: string;
  domain: string;
}

export async function writeEvent(
  supabase: SupabaseClient,
  agent: AgentConfig,
  geoContext: { state?: string; county?: string; domain?: string },
  observedValue: number | undefined,
  sourceUrl: string
): Promise<string | undefined> {
  const today = new Date().toISOString().split('T')[0];
  const sourceSeriesId = `${agent.event_source_prefix}${agent.agent_key}`;

  const description = observedValue !== undefined
    ? `${agent.display_name} threshold crossed. Observed value: ${observedValue.toFixed(2)}.`
    : `${agent.display_name} triggered a new record or keyword match.`;

  const affectedRegions: string[] = [];
  if (geoContext.state) affectedRegions.push(geoContext.state);
  if (geoContext.county) affectedRegions.push(geoContext.county);

  const { data, error } = await supabase
    .from('enterprise_macro_events')
    .insert({
      event_date: today,
      event_category: agent.event_category,
      event_name: agent.display_name,
      description,
      magnitude: 3,
      direction: 'neutral',
      relevant_industries: [agent.vertical, agent.domain],
      affected_regions: affectedRegions,
      source_name: agent.display_name,
      source_url: sourceUrl,
      source_series_id: sourceSeriesId,
      is_recession_period: false,
      is_verified: false,
      tags: [agent.vertical, agent.domain],
    })
    .select('id')
    .single();

  if (error) {
    console.error(`[AgentSwarm] writeEvent failed for ${agent.agent_key}:`, error.message);
    return undefined;
  }

  return data?.id as string | undefined;
}

export async function logRun(
  supabase: SupabaseClient,
  agentKey: string,
  result: 'hit' | 'miss' | 'error' | 'skip',
  durationMs: number,
  eventId: string | undefined,
  observedValue: number | undefined,
  geoContext: { state?: string; county?: string; domain?: string },
  errorMessage?: string
): Promise<void> {
  await supabase.from('agent_run_log').insert({
    agent_key: agentKey,
    result,
    event_id: eventId ?? null,
    duration_ms: durationMs,
    threshold_value_observed: observedValue ?? null,
    error_message: errorMessage ?? null,
    geo_context: geoContext,
  });
}
