import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assignCalendarTaskColors, calendarColorRects, calendarTaskAdjacency, type CalendarColorRect, type CalendarColorTask, type CalendarTaskGraph} from './calendar-task-adjacency';
import {calendarTaskColorIndex, calendarTaskPalette} from './calendar-task-color';
import {addCalendarDays} from '../assets/calendar-layout';
const colliding = Array.from({length: 200}, (_, i) => 'synthetic-color-' + i).filter(id => calendarTaskColorIndex(id) === 0).slice(0, 12);
const dates = Array.from({length: 14}, (_, i) => addCalendarDays('2026-10-12', i));
const task = (id: string, start = dates[0], end = start): CalendarColorTask => ({id, kind: 'task', data: {startDate: start, dueDate: end}});
const edge = (graph: CalendarTaskGraph, a: string, b: string) => assert.ok(graph.get(a)?.has(b), a + ' adjacent to ' + b);
const proper = (graph: CalendarTaskGraph, colors: Map<string, number>) => {for (const [id, neighbors] of graph) for (const neighbor of neighbors) assert.notEqual(colors.get(id), colors.get(neighbor), id + ' differs from ' + neighbor);};
const monthGraph = (tasks: CalendarColorTask[]) => calendarTaskAdjacency(calendarColorRects(tasks, dates, 'month'));

test('month vertical overlaps and touching horizontal bars with equal hash seeds get different colors', () => {
  const [a,b,c] = colliding;
  const graph = monthGraph([task(a, dates[0], dates[2]), task(b, dates[1]), task(c, dates[3], dates[4])]);
  edge(graph, a, b); edge(graph, a, c); proper(graph, assignCalendarTaskColors(graph));
});
test('cross-week task and recurrence fragments share one source node and one color', () => {
  const [a,b,c] = colliding;
  const graph = monthGraph([task(a, dates[3], dates[10]), task(b, dates[4]), task(c, dates[8]), {...task(a + '@later', dates[12]), sourceId: a}]);
  assert.equal(graph.size, 3); edge(graph, a, b); edge(graph, a, c); proper(graph, assignCalendarTaskColors(graph));
  assert.equal(graph.get(a)?.has(a), false);
});
test('month layout and colors do not depend on task input order', () => {
  const tasks = colliding.slice(0,5).map((id,i) => task(id, dates[i], dates[i+2]));
  const graph = monthGraph(tasks), reversed = monthGraph([...tasks].reverse());
  assert.deepEqual(assignCalendarTaskColors(graph), assignCalendarTaskColors(reversed));
});
test('unaffected cached colors survive edits, unrelated insertions, removal and navigation back', () => {
  const [a,b,c] = colliding;
  const first = assignCalendarTaskColors(monthGraph([task(a), task(b)]));
  const next = assignCalendarTaskColors(monthGraph([task(a), task(b), task(c, dates[8])]), first);
  assert.equal(next.get(a), first.get(a)); assert.equal(next.get(b), first.get(b));
  const otherMonth = assignCalendarTaskColors(monthGraph([task(c, dates[8])]), next);
  const cache = new Map([...next, ...otherMonth]);
  const back = assignCalendarTaskColors(monthGraph([task(a), task(b)]), cache);
  assert.deepEqual(back, first);
  const single = assignCalendarTaskColors(monthGraph([task(b)]), back);
  assert.equal(single.get(b), back.get(b), 'no snap back to hash after neighbor removal');
});
test('new conflicting task changes before a cached neighbor', () => {
  const [a,b] = colliding;
  const old = assignCalendarTaskColors(monthGraph([task(a)]));
  const graph = monthGraph([task(a),task(b)]), next = assignCalendarTaskColors(graph, old);
  assert.equal(next.get(a), old.get(a)); proper(graph, next);
});
test('week time lanes and vertically consecutive blocks use actual rectangles', () => {
  const [a,b,c,d] = colliding;
  const timed = (id: string, startTime: string, dueTime: string, day=dates[0]) => ({...task(id,day), data:{startDate:day,dueDate:day,startTime,dueTime}});
  const rects = calendarColorRects([timed(a,'09:00','10:00'),timed(b,'09:00','10:00'),timed(c,'11:00','12:00'),timed(d,'09:00','10:00',dates[1])], dates.slice(0,2), 'week');
  const graph = calendarTaskAdjacency(rects);
  edge(graph,a,b); edge(graph,a,c); edge(graph,b,c); edge(graph,b,d); proper(graph,assignCalendarTaskColors(graph));
});
test('all-day and timed areas remain separate, non-task overlays block false task adjacency', () => {
  const [a,b] = colliding;
  const rects: CalendarColorRect[] = [
    {id:a,group:'all-day',left:0,right:1,top:0,bottom:1},
    {group:'all-day',left:0,right:1,top:1,bottom:2},
    {id:b,group:'all-day',left:0,right:1,top:2,bottom:3},
    {id:b,group:'timed',left:0,right:1,top:0,bottom:1},
  ];
  assert.equal(calendarTaskAdjacency(rects).get(a)?.size,0);
});
test('partial width neighbors, separate groups and non-touching horizontal bars', () => {
  const [a,b,c,d] = colliding;
  const rects: CalendarColorRect[] = [
    {id:a,group:'one',left:0,right:3,top:0,bottom:1},
    {id:b,group:'one',left:0,right:1,top:1,bottom:2},
    {id:c,group:'one',left:2,right:3,top:1,bottom:2},
    {id:d,group:'two',left:0,right:3,top:1,bottom:2},
  ];
  const graph=calendarTaskAdjacency(rects);edge(graph,a,b);edge(graph,a,c);
  assert.equal(graph.get(b)?.has(c),false);assert.equal(graph.get(d)?.size,0);
});
test('agenda and timeline respect adjacent rendered tasks, year remains seed-only', () => {
  const [a,b] = colliding, tasks=[task(a),task(b)];
  for(const mode of ['agenda','timeline']) {const graph=calendarTaskAdjacency(calendarColorRects(tasks,dates,mode));edge(graph,a,b);proper(graph,assignCalendarTaskColors(graph));}
  assert.deepEqual(calendarColorRects(tasks,dates,'year'),[]);
});
test('finite palette overload stays deterministic and in range, never fragments a source identity', () => {
  const ids=colliding.slice(0,9), graph:CalendarTaskGraph=new Map(ids.map(id=>[id,new Set(ids.filter(other=>other!==id))]));
  const colors=assignCalendarTaskColors(graph);
  assert.equal(colors.size,9);assert.equal(new Set(colors.values()).size,calendarTaskPalette.length);
  assert.deepEqual(colors,assignCalendarTaskColors(new Map([...graph].reverse())));
  for(const color of colors.values())assert.ok(Number.isInteger(color)&&color>=0&&color<calendarTaskPalette.length);
});
test('invalid schedules are ignored and presentation leaves source tasks untouched', () => {
  const tasks=[task(colliding[0]),task('invalid','not-a-date')], before=structuredClone(tasks);
  const graph=monthGraph(tasks);assert.equal(graph.size,1);assignCalendarTaskColors(graph);assert.deepEqual(tasks,before);
});

test('neighboring week rows differ vertically without bridging an empty week', () => {
  const [a,b]=colliding;
  const graph=monthGraph([task(a,dates[0]),task(b,dates[7])]);edge(graph,a,b);proper(graph,assignCalendarTaskColors(graph));
  const longer=Array.from({length:21},(_,i)=>addCalendarDays(dates[0],i));
  const gap=calendarTaskAdjacency(calendarColorRects([task(a,longer[0]),task(b,longer[14])],longer,'month'));
  assert.equal(gap.get(a)?.has(b),false);
});


test('dense visible month and repeated sources remain deterministic and bounded to the palette', t => {
  const manyDays=Array.from({length:42},(_,i)=>addCalendarDays(dates[0],i));
  const tasks=Array.from({length:500},(_,i)=>({...task('synthetic-dense-'+i,manyDays[i%35],manyDays[i%35+3]),sourceId:'synthetic-source-'+(i%80)}));
  const start=performance.now();
  const graph=calendarTaskAdjacency(calendarColorRects(tasks,manyDays,'month'));
  const colors=assignCalendarTaskColors(graph);
  t.diagnostic(`500 visible segments / 80 source tasks colored in ${Math.round(performance.now()-start)}ms`);
  assert.equal(colors.size,80);
  assert.deepEqual(colors,assignCalendarTaskColors(graph));
  for(const color of colors.values())assert.ok(color>=0&&color<calendarTaskPalette.length);
});
