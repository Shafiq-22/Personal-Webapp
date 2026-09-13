import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  CalendarDays,
  FileText,
  Inbox,
  Library,
  ListTodo,
  Mail,
  Settings,
  Sun,
  Sparkles,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Work',
    items: [
      { href: '/today', label: 'Today', icon: Sun, description: 'Plan my day' },
      { href: '/tasks', label: 'Tasks', icon: ListTodo, description: 'Projects and subtasks' },
      { href: '/calendar', label: 'Calendar', icon: CalendarDays, description: 'Merged timeline' },
      { href: '/review', label: 'Weekly review', icon: Sparkles, description: 'What moved, what slipped' },
    ],
  },
  {
    label: 'Information',
    items: [
      { href: '/feed', label: 'Feed', icon: Inbox, description: 'Latest, ranked for you' },
      { href: '/library', label: 'Library', icon: Library, description: 'Saved with notes' },
      { href: '/digests', label: 'Digests', icon: Mail, description: 'Daily and weekly' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/analytics', label: 'Analytics', icon: BarChart3, description: 'Throughput and habits' },
      { href: '/obsidian', label: 'Obsidian', icon: FileText, description: 'Vault sync and export' },
      { href: '/settings', label: 'Settings', icon: Settings, description: 'Sources, topics, privacy' },
    ],
  },
];
