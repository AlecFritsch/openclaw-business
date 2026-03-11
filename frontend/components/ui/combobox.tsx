"use client";

import { useState, useRef, useEffect, useMemo, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// ── Types ─────────────────────────────────────────────────────────

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  group?: string;
}

interface ComboboxBaseProps {
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
  emptyMessage?: string;
}

interface SingleComboboxProps extends ComboboxBaseProps {
  multiple?: false;
  value: string;
  onChange: (value: string) => void;
}

interface MultiComboboxProps extends ComboboxBaseProps {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
}

type ComboboxProps = SingleComboboxProps | MultiComboboxProps;

// ── Combobox Component ────────────────────────────────────────────

export function Combobox(props: ComboboxProps) {
  const {
    options,
    placeholder = "Select...",
    searchPlaceholder = "Search...",
    disabled = false,
    className = "",
    emptyMessage = "No results.",
    multiple,
  } = props;

  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        o.description?.toLowerCase().includes(q) ||
        o.group?.toLowerCase().includes(q)
    );
  }, [options, search]);

  const grouped = useMemo(() => {
    const groups = new Map<string, ComboboxOption[]>();
    for (const o of filtered) {
      const g = o.group || "";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(o);
    }
    return groups;
  }, [filtered]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [search]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
    if (!isOpen) {
      setSearch("");
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[highlightedIndex]) {
          handleSelect(filtered[highlightedIndex].value);
        }
        break;
      case "Escape":
        setIsOpen(false);
        break;
    }
  };

  const handleSelect = (val: string) => {
    if (multiple) {
      const current = (props as MultiComboboxProps).value;
      const next = current.includes(val)
        ? current.filter((v) => v !== val)
        : [...current, val];
      (props as MultiComboboxProps).onChange(next);
    } else {
      (props as SingleComboboxProps).onChange(val);
      setIsOpen(false);
    }
  };

  const isSelected = (val: string): boolean => {
    if (multiple) {
      return (props as MultiComboboxProps).value.includes(val);
    }
    return (props as SingleComboboxProps).value === val;
  };

  const getDisplayValue = (): ReactNode => {
    if (multiple) {
      const vals = (props as MultiComboboxProps).value;
      if (vals.length === 0) return <span className="text-muted-foreground">{placeholder}</span>;
      return (
        <span className="flex items-center gap-1.5 flex-wrap">
          {vals.map((v) => {
            const opt = options.find((o) => o.value === v);
            return (
              <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-muted border border-border rounded-lg">
                {opt?.icon && <span className="shrink-0">{opt.icon}</span>}
                {opt?.label || v}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleSelect(v); }}
                  className="ml-0.5 text-gray-400 hover:text-red-500 transition-colors"
                >
                  ×
                </button>
              </span>
            );
          })}
        </span>
      );
    }
    const selected = options.find((o) => o.value === (props as SingleComboboxProps).value);
    if (!selected) return <span className="text-muted-foreground">{placeholder}</span>;
    return (
      <span className="flex items-center gap-2">
        {selected.icon && <span className="shrink-0">{selected.icon}</span>}
        <span className="truncate">{selected.label}</span>
      </span>
    );
  };

  // Scroll highlighted option into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className="input w-full text-left flex items-center justify-between gap-2 min-h-[38px]"
      >
        <span className="flex-1 min-w-0 text-xs">{getDisplayValue()}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
          strokeWidth={2}
        />
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute z-50 w-full mt-1 bg-card border border-border rounded-xl shadow-lg overflow-hidden"
            onKeyDown={handleKeyDown}
          >
            {/* Search */}
            <div className="p-2 border-b border-border/60">
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full px-2.5 py-1.5 text-xs bg-muted border border-border rounded-lg outline-none focus:border-gray-400 dark:focus:border-gray-600 transition-colors placeholder:text-gray-400"
              />
            </div>

            {/* Options */}
            <div ref={listRef} className="max-h-[240px] overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-xs text-gray-400 text-center">{emptyMessage}</div>
              ) : (
                Array.from(grouped.entries()).map(([group, items]) => (
                  <div key={group}>
                    {group && (
                      <div className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        {group}
                      </div>
                    )}
                    {items.map((option) => {
                      const flatIndex = filtered.indexOf(option);
                      const selected = isSelected(option.value);
                      const highlighted = flatIndex === highlightedIndex;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          data-index={flatIndex}
                          onClick={() => handleSelect(option.value)}
                          onMouseEnter={() => setHighlightedIndex(flatIndex)}
                          className={`w-full px-3 py-2 text-left flex items-center gap-2.5 text-xs transition-colors ${
                            highlighted
                              ? "bg-muted"
                              : ""
                          } ${
                            selected
                              ? "font-medium"
                              : ""
                          }`}
                        >
                          {/* Checkbox for multi / radio dot for single */}
                          <span className={`shrink-0 w-3.5 h-3.5 flex items-center justify-center border transition-colors ${
                            selected
                              ? "bg-foreground border-black dark:border-foreground"
                              : "border-gray-300 dark:border-border"
                          } ${multiple ? "rounded-lg" : "rounded-full"}`}>
                            {selected && (
                              <Check className="w-2.5 h-2.5 text-primary-foreground" strokeWidth={3} />
                            )}
                          </span>

                          {/* Icon */}
                          {option.icon && <span className="shrink-0">{option.icon}</span>}

                          {/* Label + Description */}
                          <span className="flex-1 min-w-0">
                            <span className="block truncate">{option.label}</span>
                            {option.description && (
                              <span className="block text-xs text-muted-foreground truncate mt-0.5">
                                {option.description}
                              </span>
                            )}
                          </span>

                          {/* Selected indicator for single mode */}
                          {!multiple && selected && (
                            <span className="shrink-0 text-xs text-gray-400">●</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
