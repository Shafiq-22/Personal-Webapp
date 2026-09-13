'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { parseCapture } from '@cortex/core';
import { captureTask } from '@/app/actions/tasks';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/utils';

/**
 * Natural-language quick capture.
 *
 * The preview under the field is produced by the same parser the server will
 * use, so what the user sees is what they get. On iOS this same box hands the
 * text to Apple Foundation Models first; the grammar here is the fallback and
 * the web implementation.
 */
export function CaptureBar({ timeZone }: { timeZone: string }) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Press "c" anywhere to capture, like every tool worth using.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && ['INPUT', 'TEXTAREA'].includes(target.tagName);
      if (event.key === 'c' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const offsetMinutes = -new Date().getTimezoneOffset();
  const preview = value.trim().length > 2 ? parseCapture(value, { offsetMinutes }) : null;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = value.trim();
    if (!text) return;

    startTransition(async () => {
      const result = await captureTask(text, offsetMinutes);
      if (result.ok) {
        setValue('');
        toast.success(`Added "${result.data?.title}"`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="relative">
      <label htmlFor="capture" className="sr-only">
        Capture a task in plain language
      </label>
      <div className="relative">
        {pending ? (
          <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : (
          <Plus className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        )}
        <Input
          id="capture"
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={pending}
          placeholder="Draft grant section tomorrow at 9am for 90m #Grant @writing !1"
          className="pl-9"
          aria-describedby={preview ? 'capture-preview' : undefined}
        />
      </div>

      {preview && (preview.dueAt || preview.projectName || preview.tagNames.length || preview.recurrenceRule) ? (
        <div
          id="capture-preview"
          className="absolute left-0 right-0 top-full z-20 mt-1 flex flex-wrap items-center gap-1.5 rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
        >
          <span className="text-muted-foreground">Will create:</span>
          <span className="font-medium">{preview.title}</span>
          {preview.dueAt ? <Badge variant="secondary">{formatDateTime(preview.dueAt, timeZone)}</Badge> : null}
          {preview.projectName ? <Badge variant="outline">#{preview.projectName}</Badge> : null}
          {preview.tagNames.map((tag) => (
            <Badge key={tag} variant="outline">
              @{tag}
            </Badge>
          ))}
          {preview.priority !== 'p3' ? <Badge>{preview.priority.toUpperCase()}</Badge> : null}
          {preview.estimateMinutes ? <Badge variant="secondary">{preview.estimateMinutes} min</Badge> : null}
          {preview.recurrenceRule ? <Badge variant="secondary">repeats</Badge> : null}
        </div>
      ) : null}
    </form>
  );
}
