export interface VoiceBriefTasker {
  id: string
  tasker_type: 'log_action' | 'score_prediction' | 'update_objective' | 'lifecycle_change'
  objective_id: string
  objective_title: string
  context: string
  prediction_id?: string
}

export interface VoiceBrief {
  sweep_id: string
  generated_at: string
  knowledge: {
    objective_id: string
    objective_title: string
    top_signal: string
    fac_forward?: string
  }[]
  risks: {
    objective_id: string
    objective_title: string
    items: string[]
  }[]
  opportunities: {
    objective_id: string
    objective_title: string
    items: string[]
  }[]
  action_options: {
    objective_id: string
    objective_title: string
    actions: string[]
  }[]
  taskers: VoiceBriefTasker[]
  scores: {
    objective_id: string
    objective_title: string
    confidence: number
    delta: number
    top_mover: boolean
  }[]
}
