import React, {useMemo, useState} from 'react';
import {layoutDateGrid, type GridSegment, type TaskSchedule} from '@/assets/calendar-layout';

/** Date cells remain the drag/resize targets; bars are laid out once per week. */
export default function CalendarMonthGrid<T extends {id: string; data: TaskSchedule}>({days, tasks, renderDay, renderEvent, onDrop}: {
  days: string[];
  tasks: T[];
  renderDay: (day: string, column: number) => React.ReactNode;
  renderEvent: (task: T, segment: GridSegment) => React.ReactNode;
  onDrop: (event: React.DragEvent) => void;
}) {
  const rows = useMemo(() => layoutDateGrid(tasks, days), [tasks, days.join('|')]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  return <div className="month-grid continuous-month-grid" style={{gridTemplateRows: `repeat(${rows.length},minmax(90px,1fr))`}}>
    {rows.map((row, index) => <div className="month-week" key={days[index * 7]} style={{minHeight: Math.max(90, 42 + row.lanes * 26)}}>
      {days.slice(index * 7, index * 7 + 7).map(renderDay)}
      <div className="month-week-events" style={{gridTemplateRows: `repeat(${Math.max(1, row.lanes)},23px)`}}>
        {row.segments.map(({task, segment, lane}) => <div key={task.id}
          className={'month-span' + (segment.continuesBefore ? ' continues-before' : '') + (segment.continuesAfter ? ' continues-after' : '') + (hovered === task.id || focused === task.id ? ' is-active' : '')}
          data-calendar-segment-start={segment.startDate} data-calendar-segment-end={segment.endDate}
          data-calendar-segment-task={task.id} data-calendar-lane={lane}
          style={{gridColumn: `${segment.startColumn + 1} / ${segment.endColumn + 1}`, gridRow: lane + 1}}
          onMouseEnter={() => setHovered(task.id)} onMouseLeave={() => setHovered(null)}
          onFocusCapture={() => setFocused(task.id)} onBlurCapture={event => {if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(null)}}
          onDragOver={event => event.preventDefault()} onDrop={onDrop} onDoubleClick={event => event.stopPropagation()}>
          {renderEvent(task, segment)}
        </div>)}
      </div>
    </div>)}
  </div>;
}
