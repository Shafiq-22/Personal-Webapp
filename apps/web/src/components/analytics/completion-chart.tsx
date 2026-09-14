import type { CompletionPoint } from '@cortex/core';

/**
 * Inline SVG rather than a charting library: it is one chart, it renders on the
 * server, and it keeps roughly 100 kB of JavaScript out of the bundle.
 */
export function CompletionChart({ series }: { series: CompletionPoint[] }) {
  if (series.length === 0) return <p className="text-sm text-muted-foreground">Not enough history yet.</p>;

  const width = 720;
  const height = 180;
  const padding = { top: 10, right: 10, bottom: 22, left: 28 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const max = Math.max(1, ...series.flatMap((point) => [point.created, point.completed]));
  const stepX = plotWidth / Math.max(1, series.length - 1);
  const toX = (index: number) => padding.left + index * stepX;
  const toY = (value: number) => padding.top + plotHeight - (value / max) * plotHeight;

  const path = (key: 'created' | 'completed') =>
    series.map((point, index) => `${index === 0 ? 'M' : 'L'} ${toX(index).toFixed(1)} ${toY(point[key]).toFixed(1)}`).join(' ');

  const total = series.reduce(
    (acc, point) => ({ created: acc.created + point.created, completed: acc.completed + point.completed }),
    { created: 0, completed: 0 },
  );

  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Created versus completed tasks over ${series.length} days: ${total.created} created, ${total.completed} completed.`}
      >
        {[0, 0.5, 1].map((fraction) => (
          <g key={fraction}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={toY(max * fraction)}
              y2={toY(max * fraction)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text x={4} y={toY(max * fraction) + 4} className="fill-muted-foreground text-[10px]">
              {Math.round(max * fraction)}
            </text>
          </g>
        ))}

        <path d={path('created')} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray="4 3" />
        <path d={path('completed')} fill="none" className="stroke-primary" strokeWidth={2} />

        {series.map((point, index) =>
          index % 7 === 0 ? (
            <text key={point.day} x={toX(index)} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
              {point.day.slice(5)}
            </text>
          ) : null,
        )}
      </svg>

      <figcaption className="flex gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-primary" aria-hidden /> Completed ({total.completed})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 border-t border-dashed border-muted-foreground" aria-hidden /> Created (
          {total.created})
        </span>
      </figcaption>
    </figure>
  );
}
