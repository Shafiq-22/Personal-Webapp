import { Cpu, Smartphone } from 'lucide-react';

const REASON_COPY: Record<string, string> = {
  no_device: 'No iPhone has been paired yet.',
  device_not_eligible: 'The paired device does not support Apple Intelligence.',
  model_not_ready: 'The on-device model is still downloading on your iPhone.',
  apple_intelligence_disabled: 'Apple Intelligence is switched off on your iPhone.',
  unsupported_os: 'The paired device is on an OS version without Foundation Models.',
  unknown: 'The companion app has not reported its model status yet.',
};

const CONTEXT_COPY: Record<string, string> = {
  plan: 'Your day is ordered by the built-in planner.',
  feed: 'Items are ranked by keyword and recency matching.',
  summary: 'Only extracts of the original text are available.',
  capture: 'Capture uses the built-in grammar.',
};

/**
 * Honest AI status.
 *
 * When Apple Foundation Models is not reachable the app says exactly why and
 * what it is doing instead, rather than silently degrading or implying that an
 * AI wrote something it did not.
 */
export function AfmNotice({
  status,
  context,
}: {
  status: { available: boolean; reason: string | null; deviceName: string | null };
  context: keyof typeof CONTEXT_COPY;
}) {
  if (status.available) {
    return (
      <p className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">
        <Cpu className="h-3.5 w-3.5 text-primary" aria-hidden />
        On-device AI is available on {status.deviceName ?? 'your iPhone'}. Summaries and ranking run there, offline.
      </p>
    );
  }

  return (
    <p className="flex items-start gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
      <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        <span className="font-medium text-foreground">On-device AI is unavailable.</span>{' '}
        {REASON_COPY[status.reason ?? 'unknown'] ?? REASON_COPY.unknown} {CONTEXT_COPY[context]}
      </span>
    </p>
  );
}
