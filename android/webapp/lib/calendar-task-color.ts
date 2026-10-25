import type {CSSProperties} from 'react';

// Presentation only: identity, not title, list, order or date, determines the tone.
// Paired surfaces keep small calendar labels readable in both themes.
export const calendarTaskPalette = [
  ['#e9effb', '#5279b5', '#2b3950', '#94b6eb'],
  ['#e6f2ee', '#458372', '#293e38', '#8cc9b5'],
  ['#f1ebf8', '#8b6bad', '#3c324c', '#c3a5e4'],
  ['#fbefdf', '#ad7b39', '#463b2b', '#dfbd83'],
  ['#f7e9ee', '#ad6b86', '#48313d', '#e3a6c0'],
  ['#e5f1f5', '#4b859b', '#293c46', '#91c5d9'],
  ['#eef1df', '#7b8842', '#383e2b', '#bcc98a'],
  ['#f8ebe3', '#b07955', '#48382e', '#e1b393'],
] as const;

export function calendarTaskColorIndex(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return (hash >>> 0) % calendarTaskPalette.length;
}

export function calendarTaskColor(id: string): CSSProperties {
  const [surface, edge, darkSurface, darkEdge] = calendarTaskPalette[calendarTaskColorIndex(id)];
  return {'--task-surface': surface, '--task-edge': edge, '--task-dark-surface': darkSurface, '--task-dark-edge': darkEdge} as CSSProperties;
}
