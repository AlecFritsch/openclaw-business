"use client";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  size?: "sm" | "md";
}

/**
 * Swiss Brutalism toggle switch.
 * Uses transform translate for reliable thumb positioning.
 */
export function Switch({ checked, onChange, label, disabled = false, size = "md" }: SwitchProps) {
  const isSm = size === "sm";

  // Track: width must be ~ 2x thumb width + padding
  // sm: track 28x14, thumb 10x10  →  travel = 28 - 10 - 4 = 14px
  // md: track 36x18, thumb 12x12  →  travel = 36 - 12 - 6 = 18px

  return (
    <label
      className={`inline-flex items-center gap-2 select-none ${disabled ? "opacity-40 pointer-events-none" : "cursor-pointer"}`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{
          width: isSm ? 28 : 36,
          height: isSm ? 14 : 18,
          padding: isSm ? 2 : 3,
        }}
        className={`relative shrink-0 flex items-center rounded-full transition-colors duration-150 ${
          checked
            ? "bg-foreground"
            : "bg-gray-300 dark:bg-muted"
        }`}
      >
        <span
          style={{
            width: isSm ? 10 : 12,
            height: isSm ? 10 : 12,
            transform: checked
              ? `translateX(${isSm ? 14 : 18}px)`
              : "translateX(0)",
          }}
          className={`block rounded-full transition-transform duration-150 ${
            checked
              ? "bg-card"
              : "bg-white dark:bg-gray-400"
          }`}
        />
      </button>
      {label && (
        <span className="text-xs text-muted-foreground">{label}</span>
      )}
    </label>
  );
}
