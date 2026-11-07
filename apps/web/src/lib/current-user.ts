import { headers } from 'next/headers';
import { AuthMeResponseSchema, type AuthMeResponse } from '@orgmind/shared';

const apiUrl =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function getCurrentUser(): Promise<AuthMeResponse | null> {
  const cookie = (await headers()).get('cookie');
  if (!cookie) return null;

  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      response = await fetch(`${apiUrl}/auth/me`, {
        headers: { cookie },
        cache: 'no-store',
      });
      break;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
      }
    }
  }
  if (!response) throw lastError;
  if (!response.ok) return null;
  return AuthMeResponseSchema.parse(await response.json());
}
