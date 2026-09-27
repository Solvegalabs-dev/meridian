export function displayCase(c: { case_ref: string; case_alias?: string | null }): string {
  return c.case_alias?.trim() || c.case_ref
}

export function displayObjective(o: { obj_id: string; title: string; alias?: string | null }): string {
  return o.alias?.trim() || `${o.obj_id} · ${o.title.slice(0, 20)}${o.title.length > 20 ? '…' : ''}`
}
