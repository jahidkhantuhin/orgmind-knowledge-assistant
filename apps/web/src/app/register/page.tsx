import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthForm } from '../../components/auth-form';
import { getCurrentUser } from '../../lib/current-user';
import { ThemeToggle } from '../../components/theme-toggle';

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string | string[] }>;
}) {
  if (await getCurrentUser()) redirect('/');
  const params = await searchParams;
  const inviteCode = Array.isArray(params.invite) ? params.invite[0] : params.invite;
  return (
    <main className="auth-page">
      <ThemeToggle className="knowledge-theme-toggle auth-theme-toggle" />
      <section className="auth-card">
        <Link className="brand" href="/">
          <span className="brand-mark">O</span>
          <span>
            orgmind<span className="brand-dot">.</span>
          </span>
        </Link>
        <p className="eyebrow">A CLEARER WAY TO WORK</p>
        <h1>Create your account</h1>
        <p className="auth-description">Create a workspace or join your team with an invitation.</p>
        <AuthForm mode="register" inviteCode={inviteCode ?? ''} />
        <p className="auth-switch">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
