"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

const LIGHT_ONLY = ['/', '/sign-in', '/sign-up', '/sso-callback', '/forgot-password', '/privacy', '/terms'];

type Theme = "light" | "dark";

const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void }>({
  theme: "light",
  toggleTheme: () => {},
});

function applyTheme(theme: Theme) {
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLightOnly = LIGHT_ONLY.some(p => pathname === p || pathname.startsWith(p + '/'));
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  // Read stored theme once on mount
  useEffect(() => {
    const stored = localStorage.getItem("theme") as Theme | null;
    if (stored === "dark") setTheme("dark");
    setMounted(true);
  }, []);

  // Apply theme whenever it changes or route changes
  useEffect(() => {
    if (!mounted) return;
    applyTheme(isLightOnly ? "light" : theme);
  }, [mounted, theme, isLightOnly]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === "light" ? "dark" : "light";
      localStorage.setItem("theme", next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({
    theme: isLightOnly ? "light" : theme,
    toggleTheme,
  }), [theme, isLightOnly, toggleTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
