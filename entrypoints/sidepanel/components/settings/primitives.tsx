import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Shared building blocks for the settings sub-pages.
 *
 * These replace the hand-copied toggle/slider/section/status markup that was
 * duplicated across SettingsPage, PromptControlPanel and VoiceSettingsPanel so
 * every settings surface looks and behaves identically.
 */

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div className="space-y-0.5">
        <h2 className="ds-settings-section-title">{title}</h2>
        {description && (
          <p className="ds-settings-section-description">{description}</p>
        )}
      </div>
      <div className="ds-surface-panel p-4 space-y-3">{children}</div>
    </section>
  );
}

export function ToggleRow({
  title,
  description,
  enabled,
  disabled,
  onToggle,
  trailing,
}: {
  title: string;
  description?: string;
  enabled: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex justify-between items-center gap-3">
      <div className="min-w-0">
        <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
          {title}
        </div>
        {description && (
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--ds-text-tertiary)' }}>
            {description}
          </div>
        )}
        {trailing}
      </div>
      <button
        type="button"
        onClick={() => !disabled && onToggle(!enabled)}
        disabled={disabled}
        aria-pressed={enabled}
        className="ds-switch relative shrink-0 w-10 h-[22px] rounded-full transition-colors duration-200 disabled:opacity-40"
        style={{ background: enabled ? 'var(--ds-blue)' : 'var(--ds-border)' }}
      >
        <span
          className="ds-switch-thumb absolute top-[3px] left-[3px] w-4 h-4 rounded-full transition-transform duration-200"
          style={{ transform: enabled ? 'translateX(18px)' : 'translateX(0)' }}
        />
      </button>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  disabled,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <label className="text-[11px]" style={{ color: 'var(--ds-text-secondary)' }}>
          {label}
        </label>
        <span className="text-[11px] font-mono" style={{ color: 'var(--ds-text-tertiary)' }}>
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="ds-range w-full h-1.5 rounded-full appearance-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          background: `linear-gradient(to right, var(--ds-blue) ${pct}%, var(--ds-border) ${pct}%)`,
        }}
      />
    </div>
  );
}

const inputClass =
  'w-full px-3 py-2 text-xs border outline-none transition-colors focus:border-[var(--ds-blue)]';

const inputStyle = {
  background: 'var(--ds-bg)',
  borderColor: 'var(--ds-border)',
  color: 'var(--ds-text)',
  borderRadius: 'var(--radius-ctrl)',
};

export function TextField({
  label,
  hint,
  type = 'text',
  value,
  placeholder,
  autoComplete,
  disabled = false,
  onChange,
  onKeyDown,
  trailing,
}: {
  label?: string;
  hint?: string;
  type?: string;
  value: string;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  trailing?: ReactNode;
}) {
  const input = (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      autoComplete={autoComplete}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      className={`${inputClass} ${trailing ? 'flex-1' : ''} disabled:cursor-not-allowed disabled:opacity-50`}
      style={inputStyle}
    />
  );
  return (
    <label className="block space-y-1">
      {(label || hint) && (
        <span className="block text-[10px] font-medium" style={{ color: 'var(--ds-text-tertiary)' }}>
          {label}
        </span>
      )}
      {trailing ? (
        <div className="flex gap-2 items-stretch">{input}{trailing}</div>
      ) : (
        input
      )}
      {hint && (
        <span className="block text-[10px]" style={{ color: 'var(--ds-text-tertiary)' }}>
          {hint}
        </span>
      )}
    </label>
  );
}

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

export function StatusBadge({
  configured,
  configuredLabel,
  notConfiguredLabel,
}: {
  configured: boolean;
  configuredLabel: string;
  notConfiguredLabel: string;
}) {
  return (
    <span
      className="shrink-0 text-[10px] px-2 py-0.5 uppercase tracking-wide font-medium"
      style={{
        color: configured ? 'var(--ds-success)' : 'var(--ds-text-tertiary)',
        background: configured ? 'var(--ds-success-bg)' : 'var(--ds-surface)',
        borderRadius: 'var(--radius-ctrl)',
      }}
    >
      {configured ? configuredLabel : notConfiguredLabel}
    </span>
  );
}

/**
 * In-app confirm dialog that replaces window.confirm() so destructive actions
 * (overwrite local / overwrite remote / clear all) stay within the extension UI.
 *
 * The dialog reads the destructive tone and renders a danger-styled confirm
 * button; callers pass the message shown to the user and resolve the promise
 * with true/false. Only one confirm is expected on screen at a time, so the
 * component keeps its own open/closed state and exposes an imperative handle
 * via the returned `confirm` function.
 */
export function useConfirm() {
  const [state, setState] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    resolve: (ok: boolean) => void;
  } | null>(null);

  const confirm = (opts: {
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
  }) =>
    new Promise<boolean>((resolve) => {
      setState({ ...opts, resolve });
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
  // Close on Escape, lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
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
      <div ref={dialogRef} className="ds-modal-card" onClick={(e) => e.stopPropagation()}>
        <h3 id="ds-confirm-title" className="ds-modal-title">
          {title}
        </h3>
        <p className="ds-modal-message">{message}</p>
        <div className="ds-modal-actions">
          <button type="button" className="ds-btn-cancel px-3 py-2 text-[11px] font-medium" style={{ borderRadius: 'var(--radius-ctrl)' }} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="ds-btn-danger px-3 py-2 text-[11px] font-medium" style={{ borderRadius: 'var(--radius-ctrl)' }} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Tab strip that replaces the hand-rolled `sub-tabs`/`sub-tab` markup in
 * LibraryPage / CapabilitiesPage / SettingsPage. Adds the ARIA tab semantics
 * (`role="tablist"`/`role="tab"`/`aria-selected`) and left/right keyboard
 * navigation that the duplicated markup was missing.
 */
export function SubTabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
}: {
  tabs: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  ariaLabel: string;
}) {
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = e.key === 'ArrowRight'
      ? (index + 1) % tabs.length
      : (index - 1 + tabs.length) % tabs.length;
    onChange(tabs[next].key);
  };
  return (
    <nav className="sub-tabs" aria-label={ariaLabel} role="tablist">
      {tabs.map((tab, index) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={`sub-tab${active ? ' sub-tab-active' : ''}`}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Single-select chip group (radio semantics) for compact choices like memory
 * type filters, transport kinds, saved-item kind. Replaces the bespoke pill
 * rows that were duplicated across MemoryPage / MemoryForm / SavedPage / McpPage.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  disabled = false,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
}) {
  const padding = size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-[11px]';
  return (
    <div className="ds-segmented flex flex-wrap gap-1.5" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option.key)}
            className={`${padding} font-medium border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50`}
            style={{
              borderRadius: 'var(--radius-ctrl)',
              background: active ? 'var(--ds-blue)' : 'transparent',
              color: active ? 'var(--ds-text-on-primary)' : 'var(--ds-text-secondary)',
              borderColor: active ? 'var(--ds-blue)' : 'var(--ds-border)',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Unified empty state. Replaces `ds-empty-state` hand-usage, the bespoke
 * inline `text-[11px]` boxes in ProjectsPage, and ChatPage's `ds-chat-empty`.
 */
export function EmptyState({
  title,
  description,
  actions,
  icon,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="ds-empty-state">
      <div className="ds-empty-state-icon">
        {icon ?? (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0H4" />
          </svg>
        )}
      </div>
      <p className="ds-empty-state-title">{title}</p>
      {description && <p className="ds-empty-state-description">{description}</p>}
      {actions && <div className="flex flex-wrap gap-2 justify-center mt-1">{actions}</div>}
    </div>
  );
}

/**
 * Loading skeleton bar. Used for first-paint placeholders on every page that
 * runs `load()` on mount, so the list area never flashes blank or shows a
 * false empty-state while data is in flight.
 */
export function Skeleton({ className = '', width }: { className?: string; width?: string }) {
  return (
    <div
      className={`ds-skeleton rounded ${className}`}
      style={width ? { width } : undefined}
    />
  );
}

/** A vertical stack of skeleton rows for list placeholders. */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="ds-surface-panel p-3 space-y-2">
          <Skeleton className="h-3" width="60%" />
          <Skeleton className="h-2.5" width="85%" />
        </div>
      ))}
    </div>
  );
}

/** Metric cell — a labeled value tile. Promoted from 4 duplicated definitions. */
export function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2" style={{ background: 'var(--ds-bg)', border: '1px solid var(--ds-border)' }}>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--ds-text-tertiary)' }}>{label}</div>
      <div className="mt-0.5 truncate text-[12px] font-mono" style={{ color: 'var(--ds-text)' }}>{value}</div>
    </div>
  );
}

/** Small inline spinner. Promoted from 2 duplicated definitions + ad-hoc markup. */
export function Spinner({ className = 'w-3 h-3' }: { className?: string }) {
  return (
    <span
      className={`inline-block border-2 border-current border-t-transparent rounded-full animate-spin ${className}`}
      role="status"
      aria-label="loading"
    />
  );
}

/**
 * Banner state hook: a single transient message with tone + auto-dismiss.
 * Lifted from McpPage's `dismissTimer` pattern so every page can show a
 * success banner that fades after `dismissMs` while errors stay until cleared.
 */
export function useBanner(dismissMs = 4000) {
  const [banner, setBanner] = useState<{ tone: 'success' | 'error' | 'warning' | 'info'; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (tone: 'success' | 'error' | 'warning' | 'info', text: string) => {
    if (timer.current) clearTimeout(timer.current);
    setBanner({ tone, text });
    if (tone === 'success') {
      timer.current = setTimeout(() => setBanner(null), dismissMs);
    }
  };
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    setBanner(null);
  };

  const node = banner ? (
    <StatusMessage tone={banner.tone} onDismiss={clear}>
      {banner.text}
    </StatusMessage>
  ) : null;

  return { banner, show, clear, node };
}
