"use client";

import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export function CommandPalette() {
  const router = useRouter();
  const t = useTranslations('commandPalette');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(0);

  const commands = useMemo(() => [
    { id: "1", label: t('deployNewAgent'), shortcut: "D", category: t('actions'), href: "/agents/builder" },
    { id: "2", label: t('agentTemplates'), shortcut: "M", category: t('navigation'), href: "/templates" },
    { id: "3", label: t('dashboard'), shortcut: "H", category: t('navigation'), href: "/dashboard" },
    { id: "4", label: t('analytics'), shortcut: "A", category: t('navigation'), href: "/analytics" },
    { id: "7", label: t('organization'), shortcut: "O", category: t('navigation'), href: "/organization" },
    { id: "8", label: t('billing'), shortcut: "B", category: t('navigation'), href: "/billing" },
    { id: "9", label: t('settings'), shortcut: "S", category: t('navigation'), href: "/settings" },
    { id: "10", label: t('apiKeys'), shortcut: "K", category: t('settingsCategory'), href: "/settings" },
  ], [t]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const filtered = commands.filter((cmd) =>
    cmd.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 bg-black/20 dark:bg-foreground/10 backdrop-blur-sm z-50"
          />

          {/* Palette */}
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -20 }}
              className="w-full max-w-2xl bg-card border border-gray-300 dark:border-border rounded-xl shadow-2xl overflow-hidden"
            >
              {/* Search Input */}
              <div className="border-b border-border p-4">
                <input
                  type="text"
                  placeholder={t('searchPlaceholder')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full text-base bg-transparent outline-none placeholder:text-muted-foreground"
                  autoFocus
                />
              </div>

              {/* Results */}
              <div className="max-h-96 overflow-y-auto">
                {filtered.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    {t('noResults')}
                  </div>
                ) : (
                  <div className="p-2">
                    {filtered.map((cmd, index) => (
                      <button
                        key={cmd.id}
                        onClick={() => {
                          setOpen(false);
                          if (cmd.href) router.push(cmd.href);
                        }}
                        className={`w-full flex items-center justify-between px-4 py-3 text-sm rounded-lg transition-colors ${
                          index === selected
                            ? "bg-muted"
                            : "hover:bg-muted"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-16">
                            {cmd.category}
                          </span>
                          <span>{cmd.label}</span>
                        </div>
                        <kbd className="px-2 py-1 text-xs border border-border bg-secondary rounded">
                          {cmd.shortcut}
                        </kbd>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="border-t border-border px-4 py-2 flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 border border-border rounded">↑↓</kbd>
                    {t('navigate')}
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 border border-border rounded">↵</kbd>
                    {t('select')}
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 border border-border rounded">Esc</kbd>
                    {t('closePalette')}
                  </span>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
