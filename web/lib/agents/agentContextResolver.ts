import { createServiceClient } from '@/lib/supabase/server';
import { applyExpansionRules, ResolvedGeo } from './geographicExpansion';

// --- Geo extraction from objective text ---

// Extracts state abbreviation from free text. Prefers explicit two-letter codes,
// falls back to known state names. Returns 'UT' if nothing found.
function extractState(text: string): string {
  const statePattern = /\b(UT|Utah|CO|Colorado|WY|Wyoming|ID|Idaho|NV|Nevada|AZ|Arizona|NM|New\s+Mexico|MT|Montana)\b/i;
  const match = text.match(statePattern);
  if (!match) return 'UT';
  const raw = match[1].trim();
  const nameToCode: Record<string, string> = {
    utah: 'UT', colorado: 'CO', wyoming: 'WY', idaho: 'ID',
    nevada: 'NV', arizona: 'AZ', 'new mexico': 'NM', montana: 'MT',
  };
  return nameToCode[raw.toLowerCase()] ?? raw.toUpperCase().slice(0, 2);
}

// Extracts county name from objective text.
function extractCounty(text: string): string {
  const countyPattern = /\b(Duchesne|Daggett|Uintah|Summit|Wasatch|Carbon|Emery|Grand|San Juan|Garfield|Kane|Iron|Washington|Cache|Rich|Box Elder|Weber|Davis|Salt Lake|Utah|Juab|Millard|Beaver|Piute|Wayne|Sevier|Sanpete)\s*(?:County|Co\.?)?\b/i;
  const match = text.match(countyPattern);
  return match ? match[1] : '';
}

// Extracts wildlife unit numbers or names (Utah DWR units).
function extractWildlifeUnit(text: string): string {
  const unitPattern = /\b(?:unit\s*#?\s*(\d+[A-Z]?)|Book\s+Cliffs|Uinta\s+Basin|Nine\s+Mile|North\s+Slope|Central\s+Mountains|Henry\s+Mountains)\b/i;
  const match = text.match(unitPattern);
  return match ? (match[1] ?? match[0]) : '';
}

// Combines all objective text fields for extraction.
function objectiveText(obj: {
  title?: string | null;
  notes?: string | null;
  goal_description?: string | null;
  goal_context?: string | null;
}): string {
  return [obj.title, obj.notes, obj.goal_description, obj.goal_context]
    .filter(Boolean)
    .join(' ');
}

// --- Primary resolver: objective + domain_profile ---

export type ObjectiveGeoContext = ResolvedGeo & {
  objectiveId: string;
  contextSource: 'objective' | 'domain_profile' | 'combined';
};

export async function resolveObjectiveContext(
  objectiveId: string,
  userId: string
): Promise<ObjectiveGeoContext> {
  const supabase = createServiceClient();

  // 1. Load objective
  const { data: obj } = await supabase
    .from('objectives')
    .select('id, title, notes, goal_description, goal_context, context')
    .eq('id', objectiveId)
    .eq('user_id', userId)
    .single();

  // 2. Load domain profile
  const { data: profile } = await supabase
    .from('domain_profiles')
    .select('domain, geographic_scope, expansion_rules, named_entities')
    .eq('objective_id', objectiveId)
    .maybeSingle();

  const baseGeo: Partial<ResolvedGeo> = {};
  let contextSource: ObjectiveGeoContext['contextSource'] = 'objective';

  // 3. Extract from objective text
  if (obj) {
    const text = objectiveText(obj);
    baseGeo.state = extractState(text);
    baseGeo.county = extractCounty(text);

    // Also check structured context jsonb
    const ctx = obj.context as Record<string, unknown> | null;
    if (ctx) {
      if (typeof ctx.state === 'string') baseGeo.state = ctx.state;
      if (typeof ctx.county === 'string') baseGeo.county = ctx.county;
    }

    const unit = extractWildlifeUnit(text);
    if (unit) baseGeo.adjacentUnits = [unit];
  }

  // 4. Enrich from domain profile (takes precedence over text extraction)
  if (profile?.geographic_scope) {
    const gs = profile.geographic_scope as Record<string, unknown>;
    if (typeof gs.state === 'string') baseGeo.state = gs.state;
    if (typeof gs.county === 'string') baseGeo.county = gs.county;
    if (typeof gs.place_id === 'string') baseGeo.placeId = gs.place_id;
    if (typeof gs.station_id === 'string') baseGeo.stationId = gs.station_id;
    if (Array.isArray(gs.adjacent_units)) baseGeo.adjacentUnits = gs.adjacent_units as string[];
    if (typeof gs.watershed === 'string') baseGeo.watershed = gs.watershed;
    contextSource = obj ? 'combined' : 'domain_profile';
  }

  // 5. Apply expansion rules for the domain
  const domain = profile?.domain ?? 'universal';
  const expanded = applyExpansionRules(domain, baseGeo);

  return { ...expanded, objectiveId, contextSource };
}

// --- Institution context resolver (Fusion only) ---

export type InstitutionGeoContext = {
  state: string;
  industry: string;
  configMeta: Record<string, unknown>;
};

export async function resolveInstitutionContext(
  institutionId: string
): Promise<InstitutionGeoContext> {
  const supabase = createServiceClient();

  const { data: inst } = await supabase
    .from('enterprise_institutions')
    .select('id, name, industry, config')
    .eq('id', institutionId)
    .maybeSingle();

  if (!inst) {
    return { state: 'UT', industry: '', configMeta: {} };
  }

  const config = (inst.config ?? {}) as Record<string, unknown>;
  const state = typeof config.state === 'string' ? config.state : 'UT';

  return {
    state,
    industry: (inst.industry as string) ?? '',
    configMeta: config,
  };
}

// --- URL param resolver ---

export type AgentParamInput = {
  source_url_template: string;
  domain: string;
  geo_scope?: string[] | null;
};

export function resolveAgentParams(
  agent: AgentParamInput,
  geoContext: Partial<ResolvedGeo> & { domain?: string }
): Record<string, string> {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const minus = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return fmt(d);
  };

  const state = geoContext.state ?? agent.geo_scope?.[0] ?? 'UT';
  const county = geoContext.county ?? agent.geo_scope?.[1] ?? '';
  const domain = geoContext.domain ?? agent.domain ?? 'universal';

  return {
    state,
    county,
    domain,
    domain_keyword: geoContext.domainKeyword ?? `${domain} ${state}`,
    date_today: fmt(now),
    date_minus_7: minus(7),
    date_minus_30: minus(30),
    unix_timestamp: String(Math.floor(now.getTime() / 1000)),
    place_id: geoContext.placeId ?? '8',
    station_id: geoContext.stationId ?? 'USC00420072',
  };
}

// --- Context upsert ---

export async function upsertAgentContext(
  agentKey: string,
  objectiveId: string,
  userId: string,
  resolvedGeo: ResolvedGeo,
  resolvedParams: Record<string, string>,
  expansionApplied: boolean,
  contextSource: string
): Promise<void> {
  const supabase = createServiceClient();

  await supabase.from('agent_objective_context').upsert(
    {
      agent_key: agentKey,
      objective_id: objectiveId,
      user_id: userId,
      resolved_geo: resolvedGeo,
      resolved_params: resolvedParams,
      expansion_applied: expansionApplied,
      context_source: contextSource,
      last_resolved_at: new Date().toISOString(),
    },
    { onConflict: 'agent_key,objective_id' }
  );
}

// --- Sweep integration hook (called by FF-072 at sweep time) ---

// Binds all domain-matched + universal agents to an objective, resolving
// geo context and upserting agent_objective_context rows.
// Does NOT need to be called from the cron runner — FF-072 wires this in.
export async function bindObjectiveToAgents(
  objectiveId: string,
  userId: string,
  domain: string
): Promise<void> {
  const supabase = createServiceClient();

  // Load all active agents matching the domain or universal
  const { data: agents } = await supabase
    .from('agent_configs')
    .select('agent_key, domain, geo_scope, source_url_template')
    .eq('is_active', true)
    .in('domain', [domain, 'universal']);

  if (!agents || agents.length === 0) return;

  // Resolve geo context for this objective once
  const geoCtx = await resolveObjectiveContext(objectiveId, userId);

  for (const agent of agents) {
    const params = resolveAgentParams(agent as AgentParamInput, geoCtx);
    await upsertAgentContext(
      agent.agent_key as string,
      objectiveId,
      userId,
      geoCtx,
      params,
      true,
      geoCtx.contextSource
    );
  }
}
