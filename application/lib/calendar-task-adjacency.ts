import {allocateOverlapLanes, layoutDateGrid, minuteToWall, normalizeTaskInterval, splitIntervalByDay, type TaskSchedule} from '../assets/calendar-layout';
import {calendarTaskColorIndex, calendarTaskPalette} from './calendar-task-color';

export interface CalendarColorTask {id: string; sourceId?: string; kind: string; data: TaskSchedule; externalEvent?: unknown}
export interface CalendarColorRect {id?: string; group: string; left: number; right: number; top: number; bottom: number}
export type CalendarTaskGraph = Map<string, Set<string>>;
const identity = (task: CalendarColorTask) => task.kind === 'task' && !task.externalEvent ? task.sourceId || task.id : undefined;

/** Use the same layout primitives as the rendered calendar, not task dates alone.
 * Non-task overlays occupy space but do not receive task colors. */
export function calendarColorRects(tasks: readonly CalendarColorTask[], days: readonly string[], view: string, pixelsPerHour = 52): CalendarColorRect[] {
  const rects: CalendarColorRect[] = [];
  if (view === 'year' || !days.length) return rects;
  if (view === 'month' || view === 'multiweek') {
    const rows = layoutDateGrid(tasks, days);
    rows.forEach((row, index) => {
      for (const {task, segment, lane} of row.segments) rects.push({id: identity(task), group: 'week-' + index, left: segment.startColumn, right: segment.endColumn, top: lane, bottom: lane + 1});
      // The bottom bar in a date column also neighbors the top bar in the
      // following week. Separate boundary groups avoid connecting past an
      // entirely empty week or confusing date-continuation with new tasks.
      if (index + 1 < rows.length) {
        for (const [part, offset] of [[row, 0], [rows[index + 1], row.lanes + 1]] as const) {
          for (const {task, segment, lane} of part.segments) rects.push({id: identity(task), group: 'week-boundary-' + index, left: segment.startColumn, right: segment.endColumn, top: offset + lane, bottom: offset + lane + 1});
        }
      }
    });
    return rects;
  }
  const normalized = tasks.flatMap(task => {
    try {const range = normalizeTaskInterval(task.data); return range ? [{task, range}] : [];} catch {return [];}
  });
  let agendaRow = 0;
  const timelineRows = new Map(tasks.filter(task => identity(task) && task.id === (task.sourceId || task.id) && task.data.dueDate).map((task, i) => [task.id, i]));
  days.forEach((day, column) => {
    const entries = normalized.filter(({range}) => minuteToWall(range.start).date <= day && minuteToWall(range.end - 1).date >= day)
      .sort((a, b) => (a.task.data.dueTime || '').localeCompare(b.task.data.dueTime || ''));
    if (view === 'agenda') {
      for (const {task} of entries) rects.push({id: identity(task), group: 'agenda', left: 0, right: 1, top: agendaRow, bottom: ++agendaRow});
    } else if (view === 'timeline') {
      for (const {task} of entries) {
        const row = timelineRows.get(task.id);
        if (row !== undefined) rects.push({id: identity(task), group: 'timeline', left: column, right: column + 1, top: row, bottom: row + 1});
      }
    } else {
      entries.filter(({range}) => range.allDay).forEach(({task}, row) => rects.push({id: identity(task), group: 'all-day', left: column, right: column + 1, top: row, bottom: row + 1}));
      // Preserve occurrence order for the same tie-breaking as timedLanes.
      const segments = normalized.flatMap(({task, range}) => range.allDay ? [] : splitIntervalByDay(range, day, day).map(segment => ({...segment, task})));
      for (const segment of allocateOverlapLanes(segments)) rects.push({id: identity(segment.task), group: 'timed', left: column + segment.lane / segment.laneCount, right: column + (segment.lane + 1) / segment.laneCount, top: segment.startMinute, bottom: Math.max(segment.endMinute, segment.startMinute + 15 * 60 / pixelsPerHour)});
    }
  });
  return rects;
}

/** Adjacent visible rectangles: nearest vertical neighbors in each occupied
 * column, and touching horizontal neighbors with a shared vertical span.
 * Splitting at every rectangle boundary also catches partial-width neighbors. */
export function calendarTaskAdjacency(rects: readonly CalendarColorRect[]): CalendarTaskGraph {
  const graph: CalendarTaskGraph = new Map();
  const groups = new Map<string, CalendarColorRect[]>();
  for (const rect of rects) {
    if (rect.id && !graph.has(rect.id)) graph.set(rect.id, new Set());
    const group = groups.get(rect.group) || []; group.push(rect); groups.set(rect.group, group);
  }
  const connect = (a: CalendarColorRect, b: CalendarColorRect) => {
    if (a.id && b.id && a.id !== b.id) {graph.get(a.id)!.add(b.id); graph.get(b.id)!.add(a.id);}
  };
  for (const group of groups.values()) {
    const xs = [...new Set(group.flatMap(rect => [rect.left, rect.right]))].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      const x = (xs[i - 1] + xs[i]) / 2;
      const column = group.filter(rect => rect.left < x && rect.right > x).sort((a, b) => a.top - b.top || a.bottom - b.bottom || (a.id || '').localeCompare(b.id || ''));
      for (let j = 1; j < column.length; j++) connect(column[j - 1], column[j]);
    }
    const ys = [...new Set(group.flatMap(rect => [rect.top, rect.bottom]))].sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) {
      const y = (ys[i - 1] + ys[i]) / 2;
      const row = group.filter(rect => rect.top < y && rect.bottom > y).sort((a, b) => a.left - b.left || a.right - b.right || (a.id || '').localeCompare(b.id || ''));
      for (let j = 1; j < row.length; j++) if (Math.abs(row[j - 1].right - row[j].left) < 1e-7) connect(row[j - 1], row[j]);
    }
  }
  return graph;
}

/** Retain prior session colors (or stable ID seeds) unless there is a conflict.
 * Only conflicted connected components need a more expensive greedy recolor.
 * A finite palette cannot color every possible graph after recurrence/source
 * fragments are joined: in that case keep a deterministic minimum found, never
 * change one fragment independently or invent an unreadable ninth tone. */
export function assignCalendarTaskColors(graph: CalendarTaskGraph, previous: ReadonlyMap<string, number> = new Map()): Map<string, number> {
  const size = calendarTaskPalette.length;
  const ids = [...graph.keys()].sort();
  const preferred = (id: string) => {const saved = previous.get(id); return saved !== undefined && Number.isInteger(saved) && saved >= 0 && saved < size ? saved : calendarTaskColorIndex(id);};
  const colors = new Map(ids.map(id => [id, preferred(id)]));
  const conflicts = (id: string, color: number, current: ReadonlyMap<string, number>) => [...graph.get(id)!].filter(neighbor => current.get(neighbor) === color).length;
  const choices = (id: string) => Array.from({length: size}, (_, i) => (preferred(id) + i) % size);
  const order = [...ids].sort((a, b) => Number(previous.has(a)) - Number(previous.has(b)) || graph.get(a)!.size - graph.get(b)!.size || a.localeCompare(b));
  // Every edit strictly reduces conflicting edges; unaffected nodes stay put.
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of order) {
      let best = colors.get(id)!, count = conflicts(id, best, colors);
      if (!count) continue;
      for (const color of choices(id)) {const next = conflicts(id, color, colors); if (next < count) {best = color; count = next;} if (!count) break;}
      if (best !== colors.get(id)) {colors.set(id, best); changed = true;}
    }
  }
  const visited = new Set<string>();
  for (const root of ids) {
    if (visited.has(root) || !conflicts(root, colors.get(root)!, colors)) continue;
    const component: string[] = [], pending = [root];
    while (pending.length) {const id = pending.pop()!; if (visited.has(id)) continue; visited.add(id); component.push(id); pending.push(...graph.get(id)!);}
    const candidate = new Map<string, number>();
    const remaining = new Set(component);
    while (remaining.size) {
      const saturation = (id: string) => new Set([...graph.get(id)!].flatMap(neighbor => candidate.has(neighbor) ? [candidate.get(neighbor)!] : [])).size;
      const id = [...remaining].sort((a, b) => saturation(b) - saturation(a) || graph.get(b)!.size - graph.get(a)!.size || a.localeCompare(b))[0];
      const ranked = choices(id).sort((a, b) => conflicts(id, a, candidate) - conflicts(id, b, candidate));
      candidate.set(id, ranked[0]); remaining.delete(id);
    }
    const total = (current: ReadonlyMap<string, number>) => component.reduce((sum, id) => sum + conflicts(id, current.get(id)!, current), 0);
    if (total(candidate) < total(colors)) for (const [id, color] of candidate) colors.set(id, color);
  }
  return colors;
}
