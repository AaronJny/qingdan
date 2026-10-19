import {useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject} from 'react';
import {addCalendarDays, minuteToWall, normalizeTaskInterval, resizeTaskDateEdge, resizeTaskTimeEdge, type CalendarEdge, type SchedulePatch} from '@/assets/calendar-layout';
import {canEdit, type AppRecord} from '@/lib/types';

export function calendarDateAtPoint(root: HTMLElement, x: number, y: number): string | null {
  const viewport = root.getBoundingClientRect();
  if (x < viewport.left || x >= viewport.right || y < viewport.top || y >= viewport.bottom) return null;
  for (const cell of root.querySelectorAll<HTMLElement>('[data-calendar-date]')) {
    const box = cell.getBoundingClientRect();
    if (x >= box.left && x < box.right && y >= box.top && y < box.bottom) return cell.dataset.calendarDate || null;
  }
  return null;
}

export function useCalendarResize({root, scope, pixelsPerHour, save, notify}: {
  root: RefObject<HTMLDivElement | null>; scope: string; pixelsPerHour: number;
  save: (task: AppRecord, patch: SchedulePatch) => Promise<unknown>; notify: (message: string) => void;
}) {
  const [preview, setPreview] = useState<{id: string; patch: SchedulePatch} | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const pending = useRef(new Set<string>());
  const commit = async (task: AppRecord, patch: SchedulePatch) => {
    const before = normalizeTaskInterval(task.data), after = normalizeTaskInterval(patch);
    if (!before || !after || (before.start === after.start && before.end === after.end) || pending.current.has(task.id)) return;
    pending.current.add(task.id);
    try { await save(task, patch); } catch (error) { notify((error as Error).message); }
    finally { pending.current.delete(task.id); }
  };
  // Navigation, account changes, batch selection, and unmount all cancel a gesture.
  useEffect(() => () => { cleanup.current?.(); }, [scope]);

  const begin = (event: ReactPointerEvent, task: AppRecord, edge: CalendarEdge, timed: boolean) => {
    event.preventDefault(); event.stopPropagation();
    if (event.button !== 0 || event.isPrimary === false || !canEdit(task) || pending.current.has(task.id) || !root.current) return;
    cleanup.current?.();
    const surface = root.current, pointer = event.pointerId, x = event.clientX, y = event.clientY, initialScrollTop = surface.scrollTop;
    let lastX = x, lastY = y, frame = 0, active = true;
    const original = normalizeTaskInterval(task.data);
    if (!original) return;
    const patchAt = (clientX: number, clientY: number) => {
      const deltaY = clientY - y + (timed ? surface.scrollTop - initialScrollTop : 0);
      if (Math.hypot(clientX - x, deltaY) < 4) return null;
      if (timed) return resizeTaskTimeEdge(task.data, edge, deltaY, pixelsPerHour);
      const date = calendarDateAtPoint(surface, clientX, clientY);
      return date ? resizeTaskDateEdge(task.data, edge, date) : null;
    };
    const show = () => {
      const patch = patchAt(lastX, lastY);
      setPreview(patch ? {id: task.id, patch} : null);
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointer) return;
      next.preventDefault(); lastX = next.clientX; lastY = next.clientY; show();
    };
    const stop = () => {
      active = false; cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('blur', stop);
      surface.removeEventListener('scroll', show);
      document.removeEventListener('visibilitychange', hidden);
      cleanup.current = null; setPreview(null);
    };
    const finish = (next: PointerEvent) => {
      if (next.pointerId !== pointer) return;
      const patch = patchAt(next.clientX, next.clientY); stop();
      if (patch) void commit(task, patch);
    };
    const cancel = (next: PointerEvent) => { if (next.pointerId === pointer) stop(); };
    const escape = (next: KeyboardEvent) => { if (next.key === 'Escape') { next.preventDefault(); stop(); } };
    const hidden = () => { if (document.hidden) stop(); };
    const scroll = () => {
      if (!active) return;
      // Follow the pointer through rows that are below/above the visible surface.
      if (!timed && Math.hypot(lastX - x, lastY - y) >= 4) {
        const box = surface.getBoundingClientRect();
        if (lastX >= box.left && lastX < box.right && lastY >= box.top && lastY < box.bottom) {
          const step = lastY < box.top + 32 ? -10 : lastY > box.bottom - 32 ? 10 : 0;
          if (step) { const before = surface.scrollTop; surface.scrollTop += step; if (surface.scrollTop !== before) show(); }
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    cleanup.current = stop;
    window.addEventListener('pointermove', move, {passive: false});
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', escape);
    window.addEventListener('blur', stop);
    surface.addEventListener('scroll', show, {passive: true});
    document.addEventListener('visibilitychange', hidden);
    frame = requestAnimationFrame(scroll);
  };
  const key = (event: ReactKeyboardEvent, task: AppRecord, edge: CalendarEdge, timed: boolean) => {
    const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0;
    if (!delta || !canEdit(task)) return;
    event.preventDefault(); event.stopPropagation();
    const range = normalizeTaskInterval(task.data); if (!range) return;
    const patch = timed ? resizeTaskTimeEdge(task.data, edge, delta * pixelsPerHour / 4, pixelsPerHour)
      : resizeTaskDateEdge(task.data, edge, addCalendarDays(minuteToWall(edge === 'start' ? range.start : range.end - 1).date, delta));
    const handle = event.currentTarget as HTMLElement, surface = root.current;
    void commit(task, patch).then(() => {
      // Moving an endpoint may unmount its old day cell. Keep keyboard users on
      // that endpoint, without stealing focus if they navigated elsewhere.
      requestAnimationFrame(() => {
        if (!surface || root.current !== surface || (document.activeElement !== handle && document.activeElement !== document.body)) return;
        const taskNode = Array.from(surface.querySelectorAll<HTMLElement>('[data-calendar-task]'))
          .find(node => node.dataset.calendarTask === task.id && node.querySelector(`[data-calendar-resize="${edge}"]`));
        taskNode?.querySelector<HTMLButtonElement>(`[data-calendar-resize="${edge}"]`)?.focus();
      });
    });
  };
  return {preview, begin, key};
}
