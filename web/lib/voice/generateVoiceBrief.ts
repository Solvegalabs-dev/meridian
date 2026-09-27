import type { SupabaseClient } from '@supabase/supabase-js'
import type { VoiceBrief, VoiceBriefTasker } from './voiceBriefTypes'

interface ObjectiveRow {
  id: string
  obj_id: string
  title: string
  confidence: number | null
  status: string | null
}

interface EpisodeRow {
  objective_id: string
  confidence_start: number | null
  confidence_end: number | null
  narrative: string | null
  recommended_actions: string[] | null
  inference_block: {
    confidence_pivot?: { upside_trigger?: string }
    cross_objective_flags?: { description: string; flag_type: string }[]
  } | null
}

interface PredictionRow {
  id: string
  title: string
  objective_id: string | null
  horizon_date: string | null
}

interface ActionRow {
  objective_id: string | null
}

interface FacRow {
  objective_id: string | null
  forward_signal: string | null
}

export async function generateVoiceBrief(
  supabase: SupabaseClient,
  userId: string,
  sweepId: string
): Promise<VoiceBrief> {
  // 1. Fetch active objectives
  const { data: objectivesRaw } = await supabase
    .from('objectives')
    .select('id, obj_id, title, confidence, status')
    .eq('user_id', userId)
    .in('status', ['active', 'on_track', 'at_risk'])

  const objectives = (objectivesRaw ?? []) as ObjectiveRow[]
  const objById = new Map(objectives.map(o => [o.id, o]))

  // 2. Fetch episodes from this sweep
  const { data: episodesRaw } = await supabase
    .from('objective_episodes')
    .select('objective_id, confidence_start, confidence_end, narrative, recommended_actions, inference_block')
    .eq('sweep_id', sweepId)

  const episodes = (episodesRaw ?? []) as EpisodeRow[]
  const episodeByObjId = new Map(episodes.map(e => [e.objective_id, e]))

  // 3. Try to fetch fac_reports for this sweep
  const facByObjId = new Map<string, string>()
  try {
    const { data: facRaw } = await supabase
      .from('fac_reports')
      .select('objective_id, forward_signal')
      .eq('sweep_id', sweepId)

    for (const row of (facRaw ?? []) as FacRow[]) {
      if (row.objective_id && row.forward_signal) {
        facByObjId.set(row.objective_id, row.forward_signal)
      }
    }
  } catch {
    // fac_reports may not exist yet — skip silently
  }

  // 4. Fetch open predictions within 30 days
  const horizon30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: predictionsRaw } = await supabase
    .from('predictions')
    .select('id, title, objective_id, horizon_date')
    .eq('user_id', userId)
    .eq('status', 'open')
    .lte('horizon_date', horizon30)
    .not('horizon_date', 'is', null)

  const predictions = (predictionsRaw ?? []) as PredictionRow[]

  // 5. Fetch open user_actions
  const { data: actionsRaw } = await supabase
    .from('user_actions')
    .select('objective_id')
    .eq('user_id', userId)
    .eq('status', 'open')

  const openActionObjIds = new Set(
    ((actionsRaw ?? []) as ActionRow[]).map(a => a.objective_id).filter(Boolean) as string[]
  )

  // 6. Build brief sections
  const knowledge: VoiceBrief['knowledge'] = []
  const risks: VoiceBrief['risks'] = []
  const opportunities: VoiceBrief['opportunities'] = []
  const actionOptions: VoiceBrief['action_options'] = []
  const scores: VoiceBrief['scores'] = []

  for (const obj of objectives) {
    const ep = episodeByObjId.get(obj.id)
    const topSignal = ep?.narrative?.slice(0, 300) ?? 'No signal data for this sweep.'
    const facForward = facByObjId.get(obj.id)

    knowledge.push({
      objective_id: obj.id,
      objective_title: obj.title,
      top_signal: topSignal,
      ...(facForward ? { fac_forward: facForward } : {}),
    })

    // Risks from inference_block cross_objective_flags with flag_type=dependency/conflict
    const ibRisks = (ep?.inference_block?.cross_objective_flags ?? [])
      .filter(f => f.flag_type === 'conflict' || f.flag_type === 'dependency')
      .map(f => f.description)
    if (ibRisks.length > 0) {
      risks.push({ objective_id: obj.id, objective_title: obj.title, items: ibRisks })
    }

    // Opportunities from inference_block cross_objective_flags with flag_type=opportunity
    const ibOpps = (ep?.inference_block?.cross_objective_flags ?? [])
      .filter(f => f.flag_type === 'opportunity')
      .map(f => f.description)
    if (ibOpps.length > 0) {
      opportunities.push({ objective_id: obj.id, objective_title: obj.title, items: ibOpps })
    }

    // Action options from recommended_actions
    const actions = ep?.recommended_actions ?? []
    if (actions.length > 0) {
      actionOptions.push({ objective_id: obj.id, objective_title: obj.title, actions })
    }

    // Scores — delta = confidence_end - confidence_start
    const confEnd = ep?.confidence_end ?? obj.confidence ?? 0
    const confStart = ep?.confidence_start ?? obj.confidence ?? 0
    scores.push({
      objective_id: obj.id,
      objective_title: obj.title,
      confidence: confEnd,
      delta: confEnd - confStart,
      top_mover: false, // marked below
    })
  }

  // Mark top mover by highest abs(delta)
  if (scores.length > 0) {
    let maxAbs = -1
    let maxIdx = 0
    scores.forEach((s, i) => { if (Math.abs(s.delta) > maxAbs) { maxAbs = Math.abs(s.delta); maxIdx = i } })
    scores[maxIdx].top_mover = true
  }

  // Sort scores by abs(delta) desc
  scores.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  // 7. Build taskers (max 6, priority order)
  const taskers: VoiceBriefTasker[] = []

  // Priority 1 — score_prediction
  for (const pred of predictions) {
    if (taskers.length >= 6) break
    const obj = objectives.find(o => o.id === pred.objective_id)
    if (!obj) continue
    taskers.push({
      id: `score_${pred.id}`,
      tasker_type: 'score_prediction',
      objective_id: obj.id,
      objective_title: obj.title,
      context: `Score your prediction: ${pred.title}. Hit or miss?`,
      prediction_id: pred.id,
    })
  }

  // Priority 2 — log_action (one per objective)
  for (const objId of Array.from(openActionObjIds)) {
    if (taskers.length >= 6) break
    if (taskers.some(t => t.objective_id === objId && t.tasker_type === 'log_action')) continue
    const obj = objById.get(objId)
    if (!obj) continue
    taskers.push({
      id: `log_${objId}`,
      tasker_type: 'log_action',
      objective_id: obj.id,
      objective_title: obj.title,
      context: `Log what happened on ${obj.title}.`,
    })
  }

  // Priority 3 — update_objective (abs delta > 5)
  for (const score of scores) {
    if (taskers.length >= 6) break
    if (Math.abs(score.delta) <= 5) continue
    if (taskers.some(t => t.objective_id === score.objective_id)) continue
    const sign = score.delta >= 0 ? '+' : ''
    taskers.push({
      id: `update_${score.objective_id}`,
      tasker_type: 'update_objective',
      objective_id: score.objective_id,
      objective_title: score.objective_title,
      context: `Your confidence on ${score.objective_title} moved ${sign}${score.delta} points. Want to add a note?`,
    })
  }

  // Priority 4 — lifecycle_change (paused objectives)
  const { data: pausedRaw } = await supabase
    .from('objectives')
    .select('id, title')
    .eq('user_id', userId)
    .eq('status', 'paused')

  for (const obj of (pausedRaw ?? []) as { id: string; title: string }[]) {
    if (taskers.length >= 6) break
    if (taskers.some(t => t.objective_id === obj.id)) continue
    taskers.push({
      id: `lifecycle_${obj.id}`,
      tasker_type: 'lifecycle_change',
      objective_id: obj.id,
      objective_title: obj.title,
      context: `Your goal ${obj.title} has been paused. Resume, abandon, or keep paused?`,
    })
  }

  const brief: VoiceBrief = {
    sweep_id: sweepId,
    generated_at: new Date().toISOString(),
    knowledge,
    risks,
    opportunities,
    action_options: actionOptions,
    taskers,
    scores,
  }

  await supabase.from('sweeps').update({ voice_brief: brief }).eq('id', sweepId)

  return brief
}
