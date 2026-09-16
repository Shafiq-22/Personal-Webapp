import type { CalendarEvent, Task, TimeBlock } from '../domain/index.js';

/** RFC 5545 line folding at 75 octets. */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    chunks.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest) chunks.push(` ${rest}`);
  return chunks.join('\r\n');
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function stampDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

export interface IcsOptions {
  calendarName?: string;
  productId?: string;
}

export interface IcsEntry {
  uid: string;
  summary: string;
  description?: string | null;
  location?: string | null;
  start: Date;
  end: Date;
  allDay?: boolean;
  url?: string | null;
  /** VTODO instead of VEVENT. */
  todo?: boolean;
  status?: string;
  categories?: string[];
}

export function buildIcs(entries: IcsEntry[], options: IcsOptions = {}): string {
  const { calendarName = 'Cortex', productId = '-//Cortex//Productivity//EN' } = options;
  const now = stamp(new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${productId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];

  for (const entry of entries) {
    const component = entry.todo ? 'VTODO' : 'VEVENT';
    lines.push(`BEGIN:${component}`);
    lines.push(`UID:${entry.uid}`);
    lines.push(`DTSTAMP:${now}`);
    if (entry.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${stampDate(entry.start)}`);
      lines.push(`${entry.todo ? 'DUE' : 'DTEND'};VALUE=DATE:${stampDate(entry.end)}`);
    } else {
      lines.push(`DTSTART:${stamp(entry.start)}`);
      lines.push(`${entry.todo ? 'DUE' : 'DTEND'}:${stamp(entry.end)}`);
    }
    lines.push(`SUMMARY:${escapeText(entry.summary)}`);
    if (entry.description) lines.push(`DESCRIPTION:${escapeText(entry.description)}`);
    if (entry.location) lines.push(`LOCATION:${escapeText(entry.location)}`);
    if (entry.url) lines.push(`URL:${entry.url}`);
    if (entry.status) lines.push(`STATUS:${entry.status}`);
    if (entry.categories?.length) lines.push(`CATEGORIES:${entry.categories.map(escapeText).join(',')}`);
    lines.push(`END:${component}`);
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function tasksToIcs(tasks: Task[], options: IcsOptions = {}): string {
  const entries: IcsEntry[] = tasks
    .filter((t) => t.dueAt)
    .map((task) => {
      const due = new Date(task.dueAt as string);
      return {
        uid: `task-${task.id}@cortex`,
        summary: task.title,
        description: task.notes ?? null,
        start: due,
        end: due,
        allDay: task.dueAllDay,
        todo: true,
        status: task.status === 'done' ? 'COMPLETED' : task.status === 'cancelled' ? 'CANCELLED' : 'NEEDS-ACTION',
      };
    });
  return buildIcs(entries, { calendarName: 'Cortex tasks', ...options });
}

export function eventsToIcs(events: CalendarEvent[], options: IcsOptions = {}): string {
  return buildIcs(
    events.map((event) => ({
      uid: `event-${event.id}@cortex`,
      summary: event.title,
      description: event.description ?? null,
      location: event.location ?? null,
      start: new Date(event.startAt),
      end: new Date(event.endAt),
      allDay: event.allDay,
      url: event.htmlLink ?? null,
      status: event.status.toUpperCase(),
    })),
    { calendarName: 'Cortex calendar', ...options },
  );
}

export function timeBlocksToIcs(blocks: TimeBlock[], options: IcsOptions = {}): string {
  return buildIcs(
    blocks.map((block) => ({
      uid: `block-${block.id}@cortex`,
      summary: block.title,
      description: block.rationale ?? null,
      start: new Date(block.startAt),
      end: new Date(block.endAt),
      categories: ['cortex', block.kind],
      status: block.status === 'approved' ? 'CONFIRMED' : 'TENTATIVE',
    })),
    { calendarName: 'Cortex time blocks', ...options },
  );
}
