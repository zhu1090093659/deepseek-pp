import { useEffect, useRef, useState, type ReactNode } from 'react';

export function StatusMessage({
  tone,
  children,
  onDismiss,
}: {
  tone: 'success' | 'error' | 'warning' | 'info';
  children: ReactNode;
  onDismiss?: () => void;
}) {
  const palette = {
    success: { color: 'var(--ds-success)', bg: 'var(--ds-success-bg)' },
    error: { color: 'var(--ds-danger)', bg: 'var(--ds-danger-bg)' },
    warning: { color: 'var(--ds-warning, var(--ds-text-secondary))', bg: 'var(--ds-warning-bg, var(--ds-surface))' },
    info: { color: 'var(--ds-text-secondary)', bg: 'var(--ds-surface)' },
  }[tone];
  return (
    <div
      className="text-[11px] px-3 py-2 flex items-start gap-2"
      style={{ color: palette.color, background: palette.bg, border: '1px solid var(--ds-border)', borderRadius: 'var(--radius-ctrl)' }}
    >
      <div className="flex-1 min-w-0">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="dismiss"
          className="shrink-0 leading-none opacity-60 hover:opacity-100"
          style={{ color: palette.color }}
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * In-app confirm dialog that replaces window.confirm() so destructive actions
 * stay within the extension UI and preserve keyboard focus handling.
 */
export function useConfirm() {
  const [state, setState] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    resolve: (ok: boolean) => void;
  } | null>(null);

  const confirm = (options: {
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
  }) => new Promise<boolean>((resolve) => {
    setState({ ...options, resolve });
  });

  const node = state ? (
    <ConfirmDialog
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      onConfirm={() => {
        state.resolve(true);
        setState(null);
      }}
      onCancel={() => {
        state.resolve(false);
        setState(null);
      }}
    />
  ) : null;

  return { confirm, node };
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="ds-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ds-confirm-title"
      onClick={onCancel}
    >
      <div ref={dialogRef} className="ds-modal-card" onClick={(event) => event.stopPropagation()}>
        <h3 id="ds-confirm-title" className="ds-modal-title">{title}</h3>
        <p className="ds-modal-message">{message}</p>
        <div className="ds-modal-actions">
          <button
            type="button"
            className="ds-btn-cancel px-3 py-2 text-[11px] font-medium"
            style={{ borderRadius: 'var(--radius-ctrl)' }}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="ds-btn-danger px-3 py-2 text-[11px] font-medium"
            style={{ borderRadius: 'var(--radius-ctrl)' }}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
