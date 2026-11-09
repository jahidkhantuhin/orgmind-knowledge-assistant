import Link from 'next/link';
import type { MembershipRole } from '@orgmind/shared';
import { ThemeToggle } from './theme-toggle';

type WorkspaceSection = 'assistant' | 'knowledge' | 'members' | 'evals';

export function WorkspaceNavigation({
  active,
  role,
}: {
  active: WorkspaceSection;
  role: MembershipRole;
}) {
  const links = [
    { href: '/', label: 'Overview', section: null },
    { href: '/chat', label: 'Assistant', section: 'assistant' as const },
    { href: '/knowledge', label: 'Knowledge base', section: 'knowledge' as const },
    ...(role === 'admin'
      ? [
          { href: '/settings/members', label: 'Members', section: 'members' as const },
          { href: '/settings/evals', label: 'Evals', section: 'evals' as const },
        ]
      : []),
  ];

  return (
    <header className="workspace-navigation">
      <Link className="brand workspace-navigation-brand" href="/" aria-label="OrgMind overview">
        <span className="brand-mark">O</span>
        <span>
          orgmind<span className="brand-dot">.</span>
        </span>
      </Link>
      <nav aria-label="Workspace navigation" className="workspace-navigation-links">
        {links.map((link) => {
          const selected = link.section === active;
          return (
            <Link
              aria-current={selected ? 'page' : undefined}
              className={`workspace-navigation-link${selected ? ' is-active' : ''}`}
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      <ThemeToggle className="knowledge-theme-toggle workspace-navigation-theme" />
    </header>
  );
}
