'use client';

import { useQuery } from '@tanstack/react-query';
import { HealthResponseSchema } from '@orgmind/shared';

async function readHealth() {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001'}/health`,
    { cache: 'no-store' },
  );
  const payload: unknown = await response.json();
  const parsed = HealthResponseSchema.safeParse(payload);
  if (!response.ok || !parsed.success || parsed.data.status !== 'ok')
    throw new Error('API is unavailable');
  return parsed.data;
}

export function ApiStatus() {
  const { isSuccess, isFetching } = useQuery({
    queryKey: ['api-health'],
    queryFn: readHealth,
    refetchInterval: 10_000,
    retry: 1,
  });
  const online = isSuccess;
  return (
    <span className={`status-pill ${online ? 'online' : 'offline'}`} aria-live="polite">
      <i />
      {isFetching && !online ? 'Checking API' : online ? 'API operational' : 'API unavailable'}
    </span>
  );
}
