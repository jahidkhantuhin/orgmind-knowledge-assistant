import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { UsageSummaryResponseSchema } from '@orgmind/shared';
import { WorkspaceNavigation } from '../../../components/workspace-navigation';
import { getCurrentUser } from '../../../lib/current-user';

const apiUrl =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';
const latencyLabels = [
  ['retrieval', 'Retrieval'],
  ['embedding', 'Embedding'],
  ['search', 'MongoDB search'],
  ['rerank', 'Reranking'],
  ['generation', 'Generation'],
  ['total', 'Total response'],
] as const;

function compact(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

export default async function UsagePage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect('/login');
  const organization = currentUser.organizations[0];
  if (!organization || organization.role !== 'admin') redirect('/');

  const cookie = (await headers()).get('cookie') ?? '';
  const response = await fetch(
    `${apiUrl}/organizations/${encodeURIComponent(organization.organizationId)}/usage`,
    { headers: { cookie }, cache: 'no-store' },
  );
  if (!response.ok) throw new Error('Unable to load workspace usage.');
  const { usage } = UsageSummaryResponseSchema.parse(await response.json());
  const maxRequests = Math.max(1, ...usage.daily.map((day) => day.requests));
  const maxTokens = Math.max(1, ...usage.daily.map((day) => day.inputTokens + day.outputTokens));

  return (
    <>
      <WorkspaceNavigation active="usage" role={organization.role} />
      <main className="usage-page">
        <p className="eyebrow">WORKSPACE ANALYTICS</p>
        <div className="usage-heading">
          <div>
            <h1>Usage</h1>
            <p>
              Chat activity, model tokens, estimated cost, and response time over the last 30 days.
            </p>
          </div>
          <span className="usage-window">Since {new Date(usage.since).toLocaleDateString()}</span>
        </div>
        <section className="usage-cards" aria-label="Usage summary">
          <article>
            <span>Assistant answers</span>
            <strong>{compact(usage.requests)}</strong>
          </article>
          <article>
            <span>Tokens processed</span>
            <strong>{compact(usage.totalTokens)}</strong>
            <small>
              {compact(usage.inputTokens)} in · {compact(usage.outputTokens)} out
            </small>
          </article>
          <article>
            <span>Estimated model cost</span>
            <strong>${usage.estimatedCostUsd.toFixed(4)}</strong>
            <small>Paid-list-price estimate</small>
          </article>
          <article>
            <span>Average response</span>
            <strong>{(usage.averageLatencyMs.total / 1000).toFixed(1)}s</strong>
            <small>End-to-end average</small>
          </article>
        </section>
        <section className="usage-panel">
          <header>
            <h2>Daily activity</h2>
            <span>Last 30 days</span>
          </header>
          {usage.daily.length === 0 ? (
            <p className="usage-empty">No assistant usage recorded in this workspace yet.</p>
          ) : (
            <div
              className="usage-chart"
              role="img"
              aria-label="Daily assistant answers and token usage"
            >
              {usage.daily.map((day) => (
                <div
                  className="usage-chart-day"
                  key={day.date}
                  title={`${day.date}: ${day.requests} answers, ${day.inputTokens + day.outputTokens} tokens`}
                >
                  <div className="usage-chart-bars">
                    <i style={{ height: `${Math.max(3, (day.requests / maxRequests) * 100)}%` }} />
                    <b
                      style={{
                        height: `${Math.max(3, ((day.inputTokens + day.outputTokens) / maxTokens) * 100)}%`,
                      }}
                    />
                  </div>
                  <small>
                    {new Date(`${day.date}T00:00:00Z`).toLocaleDateString(undefined, {
                      month: 'numeric',
                      day: 'numeric',
                      timeZone: 'UTC',
                    })}
                  </small>
                </div>
              ))}
            </div>
          )}
          <p className="usage-legend">
            <span /> Answers <b /> Tokens
          </p>
        </section>
        <section className="usage-panel">
          <header>
            <h2>Average latency by stage</h2>
            <span>Milliseconds</span>
          </header>
          <div className="usage-latency-list">
            {latencyLabels.map(([key, label]) => (
              <div key={key}>
                <span>{label}</span>
                <strong>{Math.round(usage.averageLatencyMs[key]).toLocaleString()} ms</strong>
              </div>
            ))}
          </div>
        </section>
        <p className="usage-note">
          Cost is an estimate using configured Gemini paid-list rates. It is not a provider invoice;
          free-tier requests may have no charge. Older chat messages have no usage metadata and are
          excluded from usage totals.
        </p>
      </main>
    </>
  );
}
