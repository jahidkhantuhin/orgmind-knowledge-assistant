import { AuthMeResponseSchema } from '@orgmind/shared';
import { NextResponse, type NextRequest } from 'next/server';

const apiUrl =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function POST(request: NextRequest) {
  const input: unknown = await request.json().catch(() => null);
  const organizationId =
    typeof input === 'object' &&
    input !== null &&
    'organizationId' in input &&
    typeof input.organizationId === 'string'
      ? input.organizationId
      : '';
  if (!organizationId) return NextResponse.json({ error: 'Choose a workspace.' }, { status: 400 });

  const sessionCookie = request.headers.get('cookie') ?? '';
  const response = await fetch(`${apiUrl}/auth/me`, {
    headers: { cookie: sessionCookie },
    cache: 'no-store',
  });
  if (!response.ok) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
  const currentUser = AuthMeResponseSchema.parse(await response.json());
  if (
    !currentUser.organizations.some(
      (organization) => organization.organizationId === organizationId,
    )
  ) {
    return NextResponse.json({ error: 'Workspace not found.' }, { status: 403 });
  }
  const result = NextResponse.json({ ok: true });
  result.cookies.set('orgmind_active_organization', organizationId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return result;
}
