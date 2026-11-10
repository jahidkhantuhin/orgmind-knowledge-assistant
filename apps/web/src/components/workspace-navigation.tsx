import Link from 'next/link';
import type { MembershipRole } from '@orgmind/shared';
import { ThemeToggle } from './theme-toggle';
import {
  getWorkspaceNavigationItems,
  type WorkspaceNavigationSection,
} from './workspace-navigation-items';

export function WorkspaceNavigation({
  active,
  role,
}: {
  active: WorkspaceNavigationSection;
  role: MembershipRole;
}) {
  const links = getWorkspaceNavigationItems(role);

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
