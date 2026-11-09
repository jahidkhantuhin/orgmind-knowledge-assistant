'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ApiStatus } from './api-status';
import { ThemeToggle } from './theme-toggle';
import type { AuthMeResponse } from '@orgmind/shared';
import { SignOutButton } from './sign-out-button';
import { useFeedback } from './feedback-provider';

function ShellContent({ currentUser }: { currentUser: AuthMeResponse }) {
  const router = useRouter();
  const { notify, updateToast } = useFeedback();
  const organization = currentUser.organizations[0];
  const firstName = currentUser.user.name.trim().split(/\s+/)[0] || currentUser.user.name;
  const initials = currentUser.user.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  async function switchWorkspace(organizationId: string) {
    const target = currentUser.organizations.find((item) => item.organizationId === organizationId);
    const toastId = notify({
      kind: 'loading',
      title: 'Switching workspace',
      description: `Opening ${target?.organizationName ?? 'your workspace'}…`,
    });
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      if (!response.ok) throw new Error('Could not switch workspace. Please try again.');
      updateToast(toastId, {
        kind: 'success',
        title: 'Workspace switched',
        description: `You’re now in ${target?.organizationName ?? 'your workspace'}.`,
        persistent: false,
      });
      router.push('/');
      router.refresh();
    } catch (cause) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not switch workspace',
        description: cause instanceof Error ? cause.message : 'Please try again.',
        persistent: false,
      });
    }
  }
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark">O</span>
          <span>
            orgmind<span className="brand-dot">.</span>
          </span>
        </Link>
        {currentUser.organizations.length > 1 ? (
          <label className="workspace-switcher">
            <span>WORKSPACE</span>
            <select
              aria-label="Active workspace"
              value={organization?.organizationId ?? ''}
              onChange={(event) => void switchWorkspace(event.target.value)}
            >
              {currentUser.organizations.map((item) => (
                <option key={item.organizationId} value={item.organizationId}>
                  {item.organizationName}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="workspace-label">{organization?.organizationName ?? 'WORKSPACE'}</div>
        )}
        <nav>
          <a className="nav-link active" href="#" aria-label="Overview" title="Overview">
            <span aria-hidden="true">⌂</span>
            <span className="nav-label">Overview</span>
          </a>
          <Link
            className="nav-link muted"
            href="/chat"
            aria-label="Knowledge assistant"
            title="Knowledge assistant"
          >
            <span aria-hidden="true">✳</span>
            <span className="nav-label">Assistant</span>
          </Link>
          <Link
            className="nav-link knowledge-nav-link muted"
            href="/knowledge"
            aria-label="Knowledge base"
            title="Knowledge base"
          >
            <span aria-hidden="true">▤</span>
            <span className="nav-label">Knowledge base</span>
          </Link>
          {organization?.role === 'admin' && (
            <Link
              className="nav-link muted"
              href="/settings/members"
              aria-label="Members"
              title="Members"
            >
              <span aria-hidden="true">♙</span>
              <span className="nav-label">Members</span>
            </Link>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="avatar">{initials}</div>
          <div>
            <strong>{currentUser.user.name}</strong>
            <small>{currentUser.user.email}</small>
          </div>
          <SignOutButton />
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> Overview
          </div>
          {currentUser.organizations.length > 1 && (
            <label className="topbar-workspace-switcher">
              <span className="visually-hidden">Active workspace</span>
              <select
                aria-label="Active workspace"
                value={organization?.organizationId ?? ''}
                onChange={(event) => void switchWorkspace(event.target.value)}
              >
                {currentUser.organizations.map((item) => (
                  <option key={item.organizationId} value={item.organizationId}>
                    {item.organizationName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="top-actions">
            <ApiStatus />
            <ThemeToggle className="icon-button" />
            <div className="avatar small">JT</div>
          </div>
        </header>
        <section className="content">
          <div className="welcome-row">
            <div>
              <p className="eyebrow">YOUR COMPANY KNOWLEDGE, CONNECTED</p>
              <h1>
                Good morning, {firstName} <span>✦</span>
              </h1>
              <p className="lead">A little more clarity for everything your team knows.</p>
            </div>
            <div className="date-chip">{organization?.role.toUpperCase() ?? 'WORKSPACE'}</div>
          </div>
          <div className="hero-card">
            <div className="hero-copy">
              <div className="hero-kicker">
                <span className="sparkle">✳</span> MEET YOUR KNOWLEDGE ASSISTANT
              </div>
              <h2>
                Answers are already
                <br />
                within reach.
              </h2>
              <p>
                OrgMind brings your company knowledge together, so your team can focus on what
                matters next.
              </p>
              <Link className="primary-button" href="/chat">
                Start a conversation <span>→</span>
              </Link>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="orb-core">✳</div>
              <div className="float-card card-a">
                ⌕ <span>Find what you need</span>
              </div>
              <div className="float-card card-b">
                ✧ <span>Grounded in your knowledge</span>
              </div>
              <div className="float-card card-c">
                ↗ <span>Move forward with clarity</span>
              </div>
            </div>
          </div>
          <div className="section-head">
            <div>
              <h3>Your workspace</h3>
              <p>Everything starts with the knowledge you share.</p>
            </div>
            <button className="text-button">
              View all <span>→</span>
            </button>
          </div>
          <div className="stat-grid">
            <article className="stat-card">
              <div className="stat-icon violet">▤</div>
              <div className="stat-label">KNOWLEDGE SOURCES</div>
              <div className="stat-value">—</div>
              <div className="stat-note">Your team&apos;s shared knowledge</div>
            </article>
            <article className="stat-card">
              <div className="stat-icon mint">✦</div>
              <div className="stat-label">QUESTIONS ANSWERED</div>
              <div className="stat-value">—</div>
              <div className="stat-note">Insights, ready when you are</div>
            </article>
            <article className="stat-card">
              <div className="stat-icon amber">◷</div>
              <div className="stat-label">TIME GIVEN BACK</div>
              <div className="stat-value">—</div>
              <div className="stat-note">More space for meaningful work</div>
            </article>
          </div>
          <div className="bottom-note">
            <span>✳</span>
            <p>
              <strong>Good knowledge grows through sharing.</strong> Connect a source to give your
              workspace a strong start.
            </p>
            <Link className="text-button" href="/knowledge">
              Explore knowledge base →
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

export function AppShell({ currentUser }: { currentUser: AuthMeResponse }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <ShellContent currentUser={currentUser} />
    </QueryClientProvider>
  );
}
