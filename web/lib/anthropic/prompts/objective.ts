import { Objective } from '@/lib/utils/types'
import { CompsResult } from '@/lib/sweep/fetchComps'
import type { CoherencePackage } from '@/lib/sweep/buildCoherencePackage'

interface RecentSignal {
  title: string
  body: string | null
  source: string | null
  relevance: string
  date: string
  signal_class?: 'market' | 'news' | 'dependency' | 'internal'
}

interface EpisodeHistoryEntry {
  episode_number: number
  narrative: string | null
  signal_count: number
}

interface ObjectiveStateInput {
  objective: Objective
  confidenceHistory: number[]
  recentSignals: RecentSignal[]
  openActions?: string[]
  comps?: CompsResult | null
  completedActionsContext?: string
  askContext?: string
  episodeHistory?: EpisodeHistoryEntry[]
  signalAbsenceCount?: number
  recentChange?: { changed_field: string; changed_at: string } | null
  outcomeRow?: { outcome_type: string; outcome_note: string | null; actual_completed_at: string | null } | null
  coherencePackage?: CoherencePackage | null
  scoredPredictionNotes?: { accuracy_score: number | null; notes: string }[] | null
}

function truncateNotes(notes: string | null | undefined, objectiveId: string): string | null {
  if (!notes || notes.trim() === '') return null
  if (notes.length <= 1000) return notes
  const sub = notes.slice(0, 1000)
  const lastPeriod = sub.lastIndexOf('. ')
  const truncAt = lastPeriod > 0 ? lastPeriod + 1 : 1000
  console.log(`[FF-032] Notes truncated for objective ${objectiveId}: ${notes.length} chars → 1000`)
  return notes.slice(0, truncAt).trimEnd() + ' [notes truncated]'
}

function extractScoringNote(notes: string): string | null {
  const marker = '[Scoring note'
  const start = notes.indexOf(marker)
  if (start === -1) return null
  const end = notes.indexOf('[Scoring note', start + 1)
  const raw = end !== -1 ? notes.slice(start, end) : notes.slice(start)
  return raw.trim().slice(0, 400) || null
}

export function buildObjectiveState(inputs: ObjectiveStateInput[]) {
  return {
    objectives: inputs.map(({ objective, confidenceHistory, recentSignals, openActions, comps, completedActionsContext, askContext, episodeHistory, signalAbsenceCount, recentChange, outcomeRow, coherencePackage, scoredPredictionNotes }) => {
      const obj = objective as Objective & {
        objective_type?: string | null
        deadline_type?: 'hard' | 'soft'
        reservation_price?: number | null
        context?: Record<string, unknown>
      }

      const truncatedNotes = truncateNotes(obj.notes, obj.id)

      const base: Record<string, unknown> = {
        obj_id: obj.obj_id,
        title: obj.title,
        category: obj.category,
        outcome: obj.outcome,
        success_condition: obj.success_condition,
        target_date: obj.target_date,
        deadline_type: obj.deadline_type ?? 'hard',
        current_confidence: obj.confidence,
        confidence_history: confidenceHistory,
        status: obj.status,
        keywords: obj.signal_keywords ?? [],
        recent_signals: recentSignals,
        open_actions: openActions ?? [],
        ...(truncatedNotes ? { notes: truncatedNotes } : {}),
      }

      // Include typed fields when present
      if (obj.objective_type) {
        Object.assign(base, { objective_type: obj.objective_type })
      }
      if (obj.deadline_type === 'soft' && obj.reservation_price != null) {
        Object.assign(base, { reservation_price: obj.reservation_price })
      }
      if (obj.context && Object.keys(obj.context).length > 0) {
        Object.assign(base, { context: obj.context })
      }

      // Inject completed actions so Claude doesn't re-recommend already-done items
      if (completedActionsContext) {
        Object.assign(base, { completed_actions: completedActionsContext })
      }

      // Inject recent Ask Meridian questions the user has asked about this objective
      if (askContext) {
        Object.assign(base, { ask_context: askContext })
      }

      // Inject episode narrative history for absence_signal inference
      // (up to 3 most recent episodes, most recent first)
      if (episodeHistory && episodeHistory.length > 0) {
        Object.assign(base, {
          episode_history: episodeHistory.map(ep => ({
            episode: ep.episode_number,
            signal_count: ep.signal_count,
            narrative_excerpt: ep.narrative ? ep.narrative.slice(0, 250) : null,
          })),
        })
      }

      // Signal absence count: how many of the recent episodes had zero signals
      // Used by R-5 (absence of signal is evidence)
      if (signalAbsenceCount !== undefined && signalAbsenceCount > 0) {
        Object.assign(base, { consecutive_zero_signal_episodes: signalAbsenceCount })
      }

      // Inject most recent change-log entry (FF-032) — signals to Claude that the
      // objective definition was recently updated, without exposing old/new values.
      if (recentChange) {
        const daysAgo = Math.round(
          (Date.now() - new Date(recentChange.changed_at).getTime()) / (1000 * 60 * 60 * 24)
        )
        const when = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`
        Object.assign(base, {
          recent_change: `Objective updated ${when}: ${recentChange.changed_field} was modified.`,
        })
      }

      // Inject recorded outcome (FF-025) — most recent objective_outcomes row for this objective.
      // Key is `recorded_outcome` (not `outcome`) because `outcome` is already the user's desired
      // outcome string from the objectives table. Omit block entirely when no row exists.
      if (outcomeRow) {
        const fmtDate = (d: string | null) =>
          d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'unknown date'
        const noteStr = outcomeRow.outcome_note
          ? ' ' + (truncateNotes(outcomeRow.outcome_note, obj.id) ?? outcomeRow.outcome_note)
          : ''
        Object.assign(base, {
          recorded_outcome: `Objective completed on ${fmtDate(outcomeRow.actual_completed_at)} with outcome: ${outcomeRow.outcome_type}.${noteStr}`,
        })
      }

      // Inject Engine 3 precision targeting context when watch sources are present.
      // Signals that directly address the watched domains are Tier 1; adjacent
      // domain signals are Tier 2; unrelated signals should only surface as
      // cross-objective dependencies.
      if (coherencePackage && coherencePackage.watchSources.length > 0) {
        const watchDomains = coherencePackage.watchSources.map(ws => {
          return ws.target_signal
            ? `[${ws.watch_type}] ${ws.url_provided} — looking for: ${ws.target_signal}`
            : `[${ws.watch_type}] ${ws.url_provided}`
        })
        Object.assign(base, {
          precision_targeting_context: {
            instruction: 'PRECISION TARGETING CONTEXT (from user\'s watch sources — treat as primary interpretive frame). A signal that directly addresses the watch source domain is Tier 1. A signal that corroborates from an adjacent domain is Tier 2. A signal unrelated to the watch source domain should only surface if it is a meaningful cross-objective dependency.',
            watch_sources: watchDomains,
            current_confidence: coherencePackage.current_confidence,
            open_actions_count: coherencePackage.openActions.length,
          },
        })
      }

      // Attach comps data for resale-type objectives
      if (comps && comps.isGrounded) {
        Object.assign(base, {
          market_comps: {
            asking_band: comps.askingBand,
            asking_prices_sample: comps.askingPrices.slice(0, 10),
            inventory_count: comps.inventoryCount,
            days_on_market: comps.daysOnMarket,
            seasonality: comps.seasonality,
            summary: comps.summary,
            sources: comps.sources.slice(0, 5),
            price_position: comps.price_position,
            p_sale_by_horizon_estimate: comps.p_sale_by_horizon_estimate,
          },
        })
      }

      // Inject user-authored scoring notes (FF-054) for MISS/PARTIAL predictions.
      // Only present on non-user_action sweeps when the user wrote a note at scoring time.
      // Directive: surface signal sources that would have caught this outcome earlier.
      if (scoredPredictionNotes && scoredPredictionNotes.length > 0) {
        const directives = scoredPredictionNotes
          .map(p => extractScoringNote(p.notes))
          .filter((n): n is string => n !== null)
        if (directives.length > 0) {
          Object.assign(base, {
            prior_prediction_miss_directives: directives.map(note => ({
              instruction: 'PRIOR PREDICTION MISS — SIGNAL SOURCING DIRECTIVE',
              note,
              guidance: 'Use this context to identify and prioritize signal sources that would have surfaced this outcome earlier. Surface any signals related to the conditions described above.',
            })),
          })
        }
      }

      return base
    }),
  }
}
