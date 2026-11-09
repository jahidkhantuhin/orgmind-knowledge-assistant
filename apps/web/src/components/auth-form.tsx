'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useFeedback } from './feedback-provider';
import {
  LoginSchema,
  RegisterSchema,
  WorkspaceInvitationPreviewSchema,
  type WorkspaceInvitationPreview,
} from '@orgmind/shared';

type AuthFormProps = { mode: 'login' | 'register'; inviteCode?: string };
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function AuthForm({ mode, inviteCode = '' }: AuthFormProps) {
  const router = useRouter();
  const { notify, updateToast } = useFeedback();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<'create' | 'join'>(
    inviteCode ? 'join' : 'create',
  );
  const [email, setEmail] = useState('');
  const [code, setCode] = useState(inviteCode);
  const [invitePreview, setInvitePreview] = useState<WorkspaceInvitationPreview | null>(null);
  const [inviteStatus, setInviteStatus] = useState('');
  const isRegister = mode === 'register';

  useEffect(() => {
    if (!isRegister || workspaceMode !== 'join' || !code.trim() || !email.trim()) return;
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(
          `${apiUrl}/auth/invitations/${encodeURIComponent(code.trim())}?email=${encodeURIComponent(email.trim())}`,
          { signal: controller.signal, cache: 'no-store' },
        );
        const payload: unknown = await response.json();
        if (!response.ok) {
          setInvitePreview(null);
          setInviteStatus(
            typeof payload === 'object' && payload !== null && 'error' in payload
              ? ((payload.error as { message?: string }).message ??
                  'Invitation could not be verified.')
              : 'Invitation could not be verified.',
          );
          return;
        }
        const preview = WorkspaceInvitationPreviewSchema.parse(payload);
        setInvitePreview(preview);
        setInviteStatus('');
      } catch {
        if (!controller.signal.aborted) {
          setInvitePreview(null);
          setInviteStatus('Could not verify the invitation. Check that the API is running.');
        }
      }
    }, 300);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [code, email, isRegister, workspaceMode]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const formData = new FormData(event.currentTarget);
    const common = {
      name: String(formData.get('name') ?? ''),
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
    };
    const result = isRegister
      ? workspaceMode === 'create'
        ? RegisterSchema.safeParse({
            ...common,
            workspaceMode,
            organizationName: String(formData.get('organizationName') ?? ''),
          })
        : RegisterSchema.safeParse({ ...common, workspaceMode, inviteCode: code })
      : LoginSchema.safeParse(common);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Check the information and try again.');
      return;
    }

    setPending(true);
    const toastId = notify({
      kind: 'loading',
      title: isRegister ? 'Creating your account' : 'Signing you in',
      description: isRegister
        ? workspaceMode === 'create'
          ? 'Setting up your workspace…'
          : 'Joining your invited workspace…'
        : 'Checking your account…',
    });
    try {
      const response = await fetch(`${apiUrl}/auth/${mode}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(result.data),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof payload === 'object' && payload !== null && 'error' in payload
            ? (payload.error as { message?: string }).message
            : undefined;
        throw new Error(message ?? 'Unable to sign in. Please try again.');
      }
      updateToast(toastId, {
        kind: 'success',
        title: isRegister ? 'You’re all set' : 'Welcome back',
        description: isRegister
          ? 'Your OrgMind workspace is ready.'
          : 'You’re signed in to OrgMind.',
        persistent: false,
      });
      router.replace('/');
      router.refresh();
    } catch (cause) {
      updateToast(toastId, {
        kind: 'error',
        title: isRegister ? 'Could not create account' : 'Could not sign in',
        description: cause instanceof Error ? cause.message : 'Please try again.',
        persistent: false,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      {isRegister && (
        <>
          <fieldset className="registration-paths">
            <legend>How would you like to start?</legend>
            <label
              className={`registration-choice${workspaceMode === 'create' ? ' selected' : ''}`}
            >
              <input
                type="radio"
                name="workspaceMode"
                value="create"
                checked={workspaceMode === 'create'}
                onChange={() => {
                  setWorkspaceMode('create');
                  setInvitePreview(null);
                  setInviteStatus('');
                }}
              />
              Create a new workspace
            </label>
            <label className={`registration-choice${workspaceMode === 'join' ? ' selected' : ''}`}>
              <input
                type="radio"
                name="workspaceMode"
                value="join"
                checked={workspaceMode === 'join'}
                onChange={() => {
                  setWorkspaceMode('join');
                  setInvitePreview(null);
                  setInviteStatus('');
                }}
              />
              Join with an invitation
            </label>
          </fieldset>
          <label>
            Your name
            <input name="name" autoComplete="name" required minLength={2} maxLength={80} />
          </label>
          {workspaceMode === 'create' ? (
            <label>
              Company or workspace name
              <input
                name="organizationName"
                autoComplete="organization"
                required
                minLength={2}
                maxLength={100}
              />
              <small>Workspace names must be unique.</small>
            </label>
          ) : (
            <>
              <label>
                Invitation code
                <input
                  name="inviteCode"
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value);
                    setInvitePreview(null);
                    setInviteStatus('');
                  }}
                  autoComplete="off"
                  required
                  minLength={20}
                  maxLength={200}
                />
              </label>
              {invitePreview && (
                <p className="invite-preview" role="status">
                  Joining <strong>{invitePreview.organizationName}</strong> as{' '}
                  <strong>{invitePreview.role}</strong>. This invitation is for{' '}
                  {invitePreview.email}.
                </p>
              )}
              {inviteStatus && (
                <p className="auth-error" role="status">
                  {inviteStatus}
                </p>
              )}
            </>
          )}
        </>
      )}
      <label>
        Work email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          value={isRegister ? email : undefined}
          onChange={
            isRegister
              ? (event) => {
                  setEmail(event.target.value);
                  setInvitePreview(null);
                  setInviteStatus('');
                }
              : undefined
          }
        />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          required
          minLength={isRegister ? 12 : 1}
          maxLength={128}
        />
        {isRegister && <small>Use at least 12 characters.</small>}
      </label>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary-button auth-submit" type="submit" disabled={pending}>
        {pending
          ? 'Please wait…'
          : isRegister
            ? workspaceMode === 'create'
              ? 'Create workspace'
              : 'Join workspace'
            : 'Sign in'}
        {!pending && <span>→</span>}
      </button>
    </form>
  );
}
