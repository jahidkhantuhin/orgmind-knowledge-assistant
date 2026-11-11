import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuditLogResponseSchema } from '@orgmind/shared';
import { WorkspaceNavigation } from '../../../components/workspace-navigation';
import { getCurrentUser } from '../../../lib/current-user';

const apiUrl =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type SearchParameters = Record<string, string | string[] | undefined>;

function parameter(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function dateFilter(value: string, endOfDay = false): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function outcomeLabel(outcome: string): string {
  return (
    {
      answered: 'Answered',
      redacted: 'Redacted',
      blocked: 'Blocked',
      failed: 'Failed',
    }[outcome] ?? outcome
  );
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParameters>;
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect('/login');
  const organization = currentUser.organizations[0];
  if (!organization || organization.role !== 'admin') redirect('/');

  const filters = await searchParams;
  const q = parameter(filters.q).slice(0, 120);
  const outcome = parameter(filters.outcome);
  const from = parameter(filters.from);
  const to = parameter(filters.to);
  const query = new URLSearchParams({ limit: '100' });
  if (q) query.set('q', q);
  if (['answered', 'redacted', 'blocked', 'failed'].includes(outcome)) {
    query.set('outcome', outcome);
  }
  const fromIso = dateFilter(from);
  const toIso = dateFilter(to, true);
  if (fromIso) query.set('from', fromIso);
  if (toIso) query.set('to', toIso);

  const cookie = (await headers()).get('cookie') ?? '';
  const response = await fetch(
    `${apiUrl}/organizations/${encodeURIComponent(organization.organizationId)}/audit-logs?${query}`,
    { headers: { cookie }, cache: 'no-store' },
  );
  if (!response.ok) throw new Error('Unable to load workspace audit logs.');
  const { logs, hasMore } = AuditLogResponseSchema.parse(await response.json());

  return (
    <>
      <WorkspaceNavigation active="audit" role={organization.role} />
      <main className="audit-page">
        <p className="eyebrow">SECURITY &amp; GOVERNANCE</p>
        <div className="audit-heading">
          <div>
            <h1>Audit log</h1>
            <p>Review workspace chat activity, safety outcomes, and source documents accessed.</p>
          </div>
          <span>
            {logs.length}
            {hasMore ? '+' : ''} events
          </span>
        </div>

        <form className="audit-filters" method="get">
          <label>
            Search
            <input name="q" defaultValue={q} placeholder="Person, question, or document" />
          </label>
          <label>
            Outcome
            <select name="outcome" defaultValue={outcome}>
              <option value="">All outcomes</option>
              <option value="answered">Answered</option>
              <option value="redacted">Redacted</option>
              <option value="blocked">Blocked</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <label>
            From
            <input type="date" name="from" defaultValue={from} />
          </label>
          <label>
            To
            <input type="date" name="to" defaultValue={to} />
          </label>
          <button type="submit">Apply filters</button>
        </form>

        {logs.length === 0 ? (
          <section className="audit-empty">
            <h2>No matching activity</h2>
            <p>Chat questions and their source access will appear here.</p>
          </section>
        ) : (
          <div className="audit-list">
            {logs.map((log) => (
              <article className="audit-entry" key={log.id}>
                <header>
                  <div>
                    <strong>{log.actorName}</strong>
                    <span>{log.actorEmail}</span>
                  </div>
                  <div className="audit-entry-meta">
                    <span className={`audit-outcome is-${log.outcome}`}>
                      {outcomeLabel(log.outcome)}
                    </span>
                    <time dateTime={log.createdAt}>{new Date(log.createdAt).toLocaleString()}</time>
                  </div>
                </header>
                <p className="audit-question">{log.question}</p>
                {log.documentNames.length > 0 ? (
                  <div className="audit-sources">
                    <span>Documents accessed</span>
                    <p>{log.documentNames.join(' · ')}</p>
                  </div>
                ) : (
                  <div className="audit-sources">
                    <span>Documents accessed</span>
                    <p>None</p>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
        {hasMore && (
          <p className="audit-limit-note">
            Showing the latest 100 events. Add filters to narrow the results.
          </p>
        )}
      </main>
    </>
  );
}
