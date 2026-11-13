import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { EvalRunsResponseSchema } from '@orgmind/shared';
import { WorkspaceNavigation } from '../../../components/workspace-navigation';
import { getCurrentUser } from '../../../lib/current-user';

const apiUrl =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';

const metrics = [
  { key: 'recallAtK', label: 'Retrieval recall@K' },
  { key: 'mrr', label: 'Mean reciprocal rank' },
  { key: 'groundedness', label: 'Faithfulness / groundedness' },
  { key: 'answerRelevance', label: 'Answer relevance' },
] as const;

const strategies = [
  { key: 'vector', label: 'Naive vector' },
  { key: 'hybrid', label: 'Hybrid' },
  { key: 'hybrid-rerank', label: 'Hybrid + rerank' },
] as const;

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default async function EvalsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect('/login');
  const organization = currentUser.organizations[0];
  if (!organization || organization.role !== 'admin') redirect('/');

  const cookie = (await headers()).get('cookie') ?? '';
  const response = await fetch(
    `${apiUrl}/organizations/${encodeURIComponent(organization.organizationId)}/evals`,
    { headers: { cookie }, cache: 'no-store' },
  );
  if (!response.ok) throw new Error('Unable to load evaluation runs.');
  const { runs } = EvalRunsResponseSchema.parse(await response.json());

  return (
    <>
      <WorkspaceNavigation active="evals" role={organization.role} />
      <main className="evals-page">
        <p className="eyebrow">RETRIEVAL QUALITY</p>
        <div className="evals-heading">
          <div>
            <h1>Evaluation runs</h1>
            <p>Compare retrieval quality and answer grounding across strategies.</p>
          </div>
          <span className="evals-count">{runs.length} recent runs</span>
        </div>

        {runs.length === 0 ? (
          <section className="evals-empty">
            <h2>No evaluation runs yet</h2>
            <p>
              Seed the evaluation documents in a dedicated workspace, then run{' '}
              <code>pnpm eval</code> from the project root.
            </p>
          </section>
        ) : (
          <div className="evals-run-list">
            {runs.map((run) => (
              <section className="evals-run-card" key={run.id}>
                <header className="evals-run-header">
                  <div>
                    <p className="eyebrow">{new Date(run.createdAt).toLocaleString()}</p>
                    <h2>{run.modelId}</h2>
                    <p>
                      Top {run.topK} · {run.variants[0]?.cases.length ?? 0} golden questions
                    </p>
                  </div>
                  <span className={`evals-result${run.passed ? ' is-passed' : ' is-failed'}`}>
                    {run.passed ? 'Passed' : 'Regression'}
                  </span>
                </header>
                <div className="evals-table-scroll">
                  <table className="evals-table">
                    <thead>
                      <tr>
                        <th scope="col">Metric</th>
                        {strategies.map((strategy) => (
                          <th scope="col" key={strategy.key}>
                            {strategy.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.map((metric) => (
                        <tr key={metric.key}>
                          <th scope="row">{metric.label}</th>
                          {strategies.map((strategy) => {
                            const result = run.variants.find(
                              (item) => item.strategy === strategy.key,
                            );
                            return (
                              <td key={strategy.key}>
                                {result ? percentage(result.metrics[metric.key]) : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="evals-threshold">
                  Recall threshold {percentage(run.minimumRecallAtK)} · rerank drop allowance{' '}
                  {percentage(run.maximumRerankRecallDrop)}
                </p>
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
