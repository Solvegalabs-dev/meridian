// The columns of a resolved geography that exist on objective_profiles (FF-096b). Anything snapshot-only,
// such as the nearest gauge's name and distance, is dropped, so spreading a resolved geography into an update
// never names a column that is not there. A separate module so callers that mock the resolver still get it.
import type { FullGeography } from '@/lib/geo/locationResolver'

export function toProfileColumns(geo: FullGeography): Omit<FullGeography, 'usgs_gauge_nearest'> {
  const { usgs_gauge_nearest: snapshotOnly, ...columns } = geo
  void snapshotOnly
  return columns
}
