'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';

type ToastKind = 'success' | 'error' | 'info' | 'loading';
export type ToastOptions = {
  kind: ToastKind;
  title: string;
  description?: string;
  persistent?: boolean;
  progress?: number;
};
type ToastEntry = ToastOptions & { id: string };
type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};
type PromptOptions = ConfirmOptions & { initialValue?: string; placeholder?: string };
export type ToastUpdater = (_id: string, _options: Partial<ToastOptions>) => void;
type Dialog =
  | (ConfirmOptions & { kind: 'confirm'; resolve: (_value: boolean) => void })
  | (PromptOptions & {
      kind: 'prompt';
      value: string;
      resolve: (_value: string | null) => void;
    });

type FeedbackContextValue = {
  notify: (_options: ToastOptions) => string;
  updateToast: ToastUpdater;
  dismissToast: (_id: string) => void;
  confirm: (_options: ConfirmOptions) => Promise<boolean>;
  prompt: (_options: PromptOptions) => Promise<string | null>;
};

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error('useFeedback must be used inside FeedbackProvider.');
  return context;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const returnFocus = useRef<HTMLElement | null>(null);

  const dismissToast = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const updateToast = useCallback(
    (id: string, options: Partial<ToastOptions>) => {
      const previousTimer = timers.current.get(id);
      if (previousTimer) clearTimeout(previousTimer);
      timers.current.delete(id);
      setToasts((current) =>
        current.map((item) => (item.id === id ? { ...item, ...options } : item)),
      );
      if (options.kind && options.kind !== 'loading' && options.persistent !== true) {
        const timer = setTimeout(() => dismissToast(id), options.kind === 'error' ? 7000 : 4200);
        timers.current.set(id, timer);
      }
    },
    [dismissToast],
  );

  const notify = useCallback(
    (options: ToastOptions) => {
      const id = createId();
      setToasts((current) => [...current, { ...options, id }]);
      if (options.kind !== 'loading' && !options.persistent) {
        const timer = setTimeout(() => dismissToast(id), options.kind === 'error' ? 7000 : 4200);
        timers.current.set(id, timer);
      }
      return id;
    },
    [dismissToast],
  );

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        returnFocus.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setDialog({ ...options, kind: 'confirm', resolve });
      }),
    [],
  );
  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        returnFocus.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setDialog({
          ...options,
          danger: options.danger ?? false,
          kind: 'prompt',
          value: options.initialValue ?? '',
          resolve,
        });
      }),
    [],
  );

  const contextValue = useMemo(
    () => ({ notify, updateToast, dismissToast, confirm, prompt }),
    [notify, updateToast, dismissToast, confirm, prompt],
  );

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
    },
    [],
  );

  useEffect(() => {
    if (!dialog) {
      returnFocus.current?.focus();
      returnFocus.current = null;
    }
  }, [dialog]);

  function closeDialog(value: boolean | string | null) {
    if (!dialog) return;
    if (dialog.kind === 'confirm' && typeof value === 'boolean') dialog.resolve(value);
    if (dialog.kind === 'prompt' && (typeof value === 'string' || value === null))
      dialog.resolve(value);
    setDialog(null);
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog(dialog?.kind === 'confirm' ? false : null);
      return;
    }
    if (event.key === 'Enter' && dialog?.kind === 'prompt') {
      event.preventDefault();
      if (dialog.value.trim()) closeDialog(dialog.value.trim());
    }
    if (event.key !== 'Tab') return;
    const focusable = event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled)',
    );
    if (focusable.length < 2) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <FeedbackContext.Provider value={contextValue}>
      {children}
      <div
        className={`toast-viewport${pathname === '/chat' ? ' toast-viewport-chat' : ''}`}
        aria-label="Notifications"
        aria-live="polite"
        role="region"
      >
        {toasts.map((toast) => (
          <article
            className={`app-toast toast-${toast.kind}`}
            key={toast.id}
            role={toast.kind === 'error' ? 'alert' : 'status'}
          >
            <span className="toast-icon" aria-hidden="true">
              {toast.kind === 'loading' ? <span className="toast-spinner" /> : null}
              {toast.kind === 'success' ? '✓' : null}
              {toast.kind === 'error' ? '!' : null}
              {toast.kind === 'info' ? '✦' : null}
            </span>
            <span className="toast-copy">
              <strong>{toast.title}</strong>
              {toast.description && <span>{toast.description}</span>}
              {toast.kind === 'loading' && (
                <span
                  className={`toast-progress${toast.progress === undefined ? '' : ' is-determinate'}`}
                  style={
                    toast.progress === undefined
                      ? undefined
                      : ({ '--toast-progress': `${toast.progress}%` } as CSSProperties)
                  }
                  aria-hidden="true"
                />
              )}
            </span>
            <button
              className="toast-dismiss"
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismissToast(toast.id)}
            >
              ×
            </button>
          </article>
        ))}
      </div>
      {dialog && (
        <div
          className="app-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              closeDialog(dialog.kind === 'confirm' ? false : null);
          }}
        >
          <div
            aria-labelledby="app-dialog-title"
            aria-describedby="app-dialog-message"
            aria-modal="true"
            className="app-dialog"
            onKeyDown={handleDialogKeyDown}
            role={dialog.kind === 'confirm' && dialog.danger !== false ? 'alertdialog' : 'dialog'}
          >
            <div className={`dialog-symbol${dialog.danger === false ? ' dialog-symbol-info' : ''}`}>
              {dialog.danger === false ? '✦' : '!'}
            </div>
            <p className="dialog-eyebrow">
              {dialog.danger === false ? 'CONFIRM ACTION' : 'PLEASE CONFIRM'}
            </p>
            <h2 id="app-dialog-title">{dialog.title}</h2>
            <p className="dialog-message" id="app-dialog-message">
              {dialog.message}
            </p>
            {dialog.kind === 'prompt' && (
              <input
                autoFocus
                className="dialog-input"
                placeholder={dialog.placeholder}
                value={dialog.value}
                onChange={(event) => setDialog({ ...dialog, value: event.target.value })}
              />
            )}
            <div className="app-dialog-actions">
              <button
                autoFocus={dialog.kind === 'confirm'}
                className="secondary-button"
                type="button"
                onClick={() => closeDialog(dialog.kind === 'confirm' ? false : null)}
              >
                {dialog.cancelLabel ?? 'Cancel'}
              </button>
              <button
                className={dialog.danger === false ? 'primary-button' : 'dialog-danger-button'}
                disabled={dialog.kind === 'prompt' && !dialog.value.trim()}
                type="button"
                onClick={() => closeDialog(dialog.kind === 'prompt' ? dialog.value.trim() : true)}
              >
                {dialog.confirmLabel ?? (dialog.kind === 'prompt' ? 'Save' : 'Continue')}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}
