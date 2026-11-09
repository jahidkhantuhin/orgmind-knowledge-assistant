'use client';

import { useRouter } from 'next/navigation';
import { useFeedback } from './feedback-provider';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function SignOutButton() {
  const router = useRouter();
  const { notify, updateToast } = useFeedback();

  async function signOut() {
    const toastId = notify({
      kind: 'loading',
      title: 'Signing out',
      description: 'Ending your workspace session…',
    });
    try {
      const response = await fetch(`${apiUrl}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('The session could not be ended. Please try again.');
      updateToast(toastId, {
        kind: 'success',
        title: 'Signed out',
        description: 'Your session has ended securely.',
        persistent: false,
      });
      router.replace('/login');
      router.refresh();
    } catch (cause) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not sign out',
        description: cause instanceof Error ? cause.message : 'Please try again.',
        persistent: false,
      });
    }
  }

  return (
    <button className="sign-out-button" onClick={signOut} aria-label="Sign out" title="Sign out">
      <span aria-hidden="true">↗</span>
      <span className="sign-out-label">Sign out</span>
    </button>
  );
}
