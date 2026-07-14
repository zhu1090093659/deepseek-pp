const FALLBACK_ROWS = 3;

export default function RouteFallback() {
  return (
    <div className="p-4 space-y-2" aria-hidden="true">
      {Array.from({ length: FALLBACK_ROWS }, (_, index) => (
        <div key={index} className="ds-surface-panel p-3 space-y-2">
          <div className="ds-skeleton rounded h-3" style={{ width: '60%' }} />
          <div className="ds-skeleton rounded h-2.5" style={{ width: '85%' }} />
        </div>
      ))}
    </div>
  );
}
