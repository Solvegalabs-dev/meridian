// Classes for the notices FF-089 P0 adds to Strike. Every background is opaque and every
// text colour is explicit, so a notice reads the same on any page background (the
// phone preview's page area above the dark header is white). No alpha backgrounds
// (bg-*/30) and no opacity on text. Contrast is WCAG AA (4.5:1) or better.
// Notice text is text-sm (14px) or larger; the first line is medium weight.
export const NOTICE_CLASSES = {
  // "Season opens / Trip opens {date}" banner: solid light, dark text.
  opens: 'mx-4 mt-4 rounded-lg px-4 py-3 text-sm font-medium bg-blue-100 border border-blue-400 text-blue-950',
  // Fixed closed message on an ended hunt: solid dark, light text.
  closed: 'mx-4 mt-4 rounded-lg px-4 py-3 text-sm font-medium bg-slate-800 border border-slate-600 text-slate-100',
  // "Last brief, {date} · {verdict}" history: solid dark, clearly secondary but readable.
  history: 'mx-4 mt-3 rounded-lg px-4 py-3 text-sm bg-slate-800 border border-slate-700 text-slate-300',
  historyHeading: 'font-medium text-slate-200',
  // "Trip ended on {date}" / "Season closed on {date}" label on a list row (no opacity).
  endedLabel: 'text-sm font-medium text-slate-300',
  // Unit name on a muted (ended or missed) row: dimmed by colour, not by opacity.
  mutedName: 'text-sm font-medium text-slate-400',
} as const
