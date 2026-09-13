'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const FORMATS = {
  library: [
    { format: 'bibtex', label: 'BibTeX (.bib)' },
    { format: 'ris', label: 'RIS (.ris)' },
    { format: 'csv', label: 'CSV' },
    { format: 'markdown', label: 'Markdown notes' },
  ],
  tasks: [
    { format: 'csv', label: 'CSV' },
    { format: 'ics', label: 'Calendar (.ics)' },
    { format: 'markdown', label: 'Markdown' },
  ],
  calendar: [{ format: 'ics', label: 'Calendar (.ics)' }],
} as const;

export function ExportMenu({ scope }: { scope: keyof typeof FORMATS }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Download className="h-4 w-4" /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Download</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {FORMATS[scope].map((option) => (
          <DropdownMenuItem key={option.format} asChild>
            <a href={`/api/export/${option.format}?scope=${scope}`} download>
              {option.label}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
