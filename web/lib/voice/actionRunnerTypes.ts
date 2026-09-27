export type ActionRunnerStatus =
  | 'idle'
  | 'announcing'
  | 'listening'
  | 'parsing'
  | 'confirming'
  | 'writing'
  | 'done'

export interface VoiceIntent {
  action_type: string | null
  note: string
  date: string | null
  confidence: number
  clarifying_question: string | null
}
