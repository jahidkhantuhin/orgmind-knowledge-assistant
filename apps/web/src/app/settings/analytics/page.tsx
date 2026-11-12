import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { WorkspaceAnalyticsResponseSchema } from '@orgmind/shared';
import { WorkspaceNavigation } from '../../../components/workspace-navigation';
import { getCurrentUser } from '../../../lib/current-user';

const apiUrl =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default async function AnalyticsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect('/login');
  const organization = currentUser.organizations[0];
  if (!organization || organization.role !== 'admin') redirect('/');
  const cookie = (await headers()).get('cookie') ?? '';
  const base = `${apiUrl}/organizations/${encodeURIComponent(organization.organizationId)}`;
  const [analyticsResponse, exportResponse] = await Promise.all([
    fetch(`${base}/analytics`, { headers: { cookie }, cache: 'no-store' }),
    fetch(`${base}/feedback/export`, { headers: { cookie }, cache: 'no-store' }),
  ]);
  if (!analyticsResponse.ok || !exportResponse.ok)
    throw new Error('Unable to load workspace analytics.');
  const { analytics } = WorkspaceAnalyticsResponseSchema.parse(await analyticsResponse.json());
  const exportPayload = (await exportResponse.json()) as { cases?: unknown[] };
  return (
    <>
      <WorkspaceNavigation active="analytics" role={organization.role} />
      <main className="analytics-page">
        <p className="eyebrow">WORKSPACE INSIGHTS · LAST 30 DAYS</p>
        <header className="analytics-heading">
          <div>
            <h1>Analytics</h1>
            <p>See what your team asks and where its knowledge has gaps.</p>
          </div>
          <a className="secondary-button" href={`${base}/feedback/export`} download>
            Export positive feedback
          </a>
        </header>
        <section className="analytics-cards">
          <article>
            <span>Questions</span>
            <strong>{analytics.totalQuestions}</strong>
          </article>
          <article>
            <span>Unanswered</span>
            <strong>{analytics.unansweredQuestions}</strong>
          </article>
          <article>
            <span>Low confidence</span>
            <strong>{Math.round(analytics.lowConfidenceRate * 100)}%</strong>
          </article>
          <article>
            <span>Helpful / not helpful</span>
            <strong>
              {analytics.feedback.positive} / {analytics.feedback.negative}
            </strong>
          </article>
        </section>
        <div className="analytics-columns">
          <section className="analytics-panel">
            <h2>Top questions</h2>
            {analytics.topQuestions.length ? (
              <ol>
                {analytics.topQuestions.map((item) => (
                  <li key={item.question}>
                    <span>{item.question}</span>
                    <b>{item.count}</b>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No questions recorded in this period.</p>
            )}
          </section>
          <section className="analytics-panel">
            <h2>Knowledge gaps</h2>
            <p>Questions answered without usable citations or accessible source documents.</p>
            {analytics.knowledgeGaps.length ? (
              <ol>
                {analytics.knowledgeGaps.map((item) => (
                  <li key={item.question}>
                    <span>{item.question}</span>
                    <b>{item.count}</b>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No gaps found in this period.</p>
            )}
          </section>
        </div>
        <p className="analytics-footnote">
          The export currently includes{' '}
          {Array.isArray(exportPayload.cases) ? exportPayload.cases.length : 0} positively rated
          answers from the last 90 days. Review the JSON before adding cases to the golden
          evaluation dataset.
        </p>
      </main>
    </>
  );
}
