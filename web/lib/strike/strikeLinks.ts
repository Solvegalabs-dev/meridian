// Where "Open strike view" goes from Mission Control. /strike/[id] takes an objective_profiles
// PK first, then falls back to the arc objective_id. Campaign membership does not matter to the
// route, so the profile PK is used whenever a profile exists. No profile means the objective-level view.
export function strikeDetailHref(input: { profileId: string | null | undefined; objectiveId: string }): string {
  return input.profileId ? `/strike/${input.profileId}` : `/objectives/${input.objectiveId}/strike`
}
