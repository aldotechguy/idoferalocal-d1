import React from 'react';
import { Minus, Plus } from 'lucide-react';

type Props = {
  value: number;
  max: number;
  onChange: (quantity: number) => void | boolean | Promise<void | boolean>;
  min?: number;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
};

export const MallQuantityControl: React.FC<Props> = ({
  value,
  max,
  onChange,
  min = 0,
  disabled = false,
  compact = false,
  label = 'Quantity',
}) => {
  const [draft, setDraft] = React.useState(String(value));
  const [pending, setPending] = React.useState(false);
  const safeMax = Math.max(min, Math.floor(max));

  React.useEffect(() => setDraft(String(value)), [value]);

  const commit = React.useCallback(async (raw: string | number) => {
    const parsed = typeof raw === 'number' ? raw : Number.parseInt(raw, 10);
    const next = Number.isFinite(parsed)
      ? Math.min(safeMax, Math.max(min, Math.floor(parsed)))
      : value;
    setDraft(String(next));
    if (next === value || pending) return;
    setPending(true);
    try {
      const accepted = await onChange(next);
      if (accepted === false) setDraft(String(value));
    } finally {
      setPending(false);
    }
  }, [min, onChange, pending, safeMax, value]);

  const controlDisabled = disabled || pending;
  const buttonSize = compact ? 'w-7 h-7' : 'w-9 h-9';
  const inputSize = compact ? 'w-11 h-7' : 'w-12 h-9';

  return (
    <div className="inline-flex items-center gap-1.5" aria-label={label}>
      <button
        type="button"
        onClick={() => commit(value - 1)}
        disabled={controlDisabled || value <= min}
        className={`${buttonSize} rounded-lg border border-slate-200 bg-white/70 flex items-center justify-center text-slate-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
        aria-label={`Decrease ${label.toLowerCase()}`}
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={draft}
        onChange={(event) => {
          const next = event.target.value.replace(/\D/g, '').slice(0, String(safeMax).length);
          setDraft(next);
        }}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
        disabled={controlDisabled}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={safeMax}
        aria-valuenow={value}
        className={`${inputSize} rounded-lg border border-slate-200 bg-white/75 px-1 text-center text-base font-extrabold text-slate-900 tabular-nums focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 disabled:opacity-60`}
      />
      <button
        type="button"
        onClick={() => commit(value + 1)}
        disabled={controlDisabled || value >= safeMax}
        className={`${buttonSize} rounded-lg border border-slate-200 bg-white/70 flex items-center justify-center text-slate-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
        aria-label={`Increase ${label.toLowerCase()}`}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};