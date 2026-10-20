import { type ReactNode, useEffect, useId, useState } from 'react';

interface NumProps {
  label: string;
  hint?: string;
  /** Value in SI units. */
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  /** SI units per display unit (e.g. 1e5 for bar). */
  scale?: number;
  min: number;
  max: number;
  step?: number;
  slider?: boolean;
  digits?: number;
  integer?: boolean;
}

/** Numeric input in display units with an optional slider; commits on Enter/blur. */
export function NumField({ label, hint, value, onChange, unit, scale = 1, min, max, step, slider, digits, integer }: NumProps) {
  const id = useId();
  const display = value / scale;
  const fmt = (v: number) => (integer ? String(Math.round(v)) : digits !== undefined ? v.toFixed(digits) : String(Number(v.toPrecision(5))));
  const [text, setText] = useState(fmt(display));
  useEffect(() => setText(fmt(display)), [display]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (raw: string) => {
    const v = Number(raw);
    if (!Number.isFinite(v)) return setText(fmt(display));
    const c = Math.min(max, Math.max(min, integer ? Math.round(v) : v));
    setText(fmt(c));
    if (c !== display) onChange(c * scale);
  };
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {hint && <span className="hint">{hint}</span>}
      </label>
      <div className="num">
        <input
          id={id}
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          }}
        />
        {unit && <span className="unit">{unit}</span>}
      </div>
      {slider && (
        <input
          className="slider"
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step ?? (max - min) / 200}
          value={display}
          onChange={(e) => onChange(Number(e.target.value) * scale)}
        />
      )}
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="field wide" style={label ? undefined : { gridTemplateColumns: '1fr' }}>
      {label && <label>{label}</label>}
      <div className="segmented" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="toggle-row">
      <label htmlFor={id} style={{ color: 'var(--text-secondary)', fontSize: 12.5 }}>
        {label}
        {hint && <span className="hint" style={{ display: 'block', color: 'var(--text-muted)', fontSize: 11 }}>{hint}</span>}
      </label>
      <span className="switch">
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span />
      </span>
    </div>
  );
}

export function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section">
      <button className="section-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {title}
        <svg className="chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}
