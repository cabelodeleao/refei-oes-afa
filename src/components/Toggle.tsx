"use client";

interface ToggleProps {
  on: boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
  label?: string;
}

export default function Toggle({ on, disabled, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-on={on}
      disabled={disabled}
      className="toggle"
      onClick={() => !disabled && onChange?.(!on)}
    >
      <span className="toggle-knob" />
    </button>
  );
}
