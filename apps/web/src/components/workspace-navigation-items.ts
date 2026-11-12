import type { MembershipRole } from '@orgmind/shared';

export type WorkspaceNavigationSection =
  | 'overview'
  | 'assistant'
  | 'knowledge'
  | 'members'
  | 'integrations'
  | 'evals'
  | 'usage'
  | 'analytics'
  | 'audit';

export type WorkspaceNavigationItem = {
  href: string;
  label: string;
  section: WorkspaceNavigationSection;
  icon: string;
  adminOnly?: boolean;
};

export const workspaceNavigationItems: WorkspaceNavigationItem[] = [
  { href: '/', label: 'Overview', section: 'overview', icon: '⌂' },
  { href: '/chat', label: 'Assistant', section: 'assistant', icon: '✳' },
  { href: '/knowledge', label: 'Knowledge base', section: 'knowledge', icon: '▤' },
  {
    href: '/settings/members',
    label: 'Members',
    section: 'members',
    icon: '♙',
    adminOnly: true,
  },
  {
    href: '/settings/integrations',
    label: 'Integrations',
    section: 'integrations',
    icon: '↔',
    adminOnly: true,
  },
  { href: '/settings/evals', label: 'Evals', section: 'evals', icon: '▥', adminOnly: true },
  { href: '/settings/usage', label: 'Usage', section: 'usage', icon: '◷', adminOnly: true },
  {
    href: '/settings/analytics',
    label: 'Analytics',
    section: 'analytics',
    icon: '▤',
    adminOnly: true,
  },
  { href: '/settings/audit', label: 'Audit log', section: 'audit', icon: '▦', adminOnly: true },
];

export function getWorkspaceNavigationItems(role: MembershipRole) {
  return workspaceNavigationItems.filter((item) => !item.adminOnly || role === 'admin');
}
