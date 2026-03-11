"use client";

import { createContext, useContext } from "react";

const ThinkingLabelContext = createContext<string>("");

export function ThinkingLabelProvider({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <ThinkingLabelContext.Provider value={label}>
      {children}
    </ThinkingLabelContext.Provider>
  );
}

export function useThinkingLabel() {
  return useContext(ThinkingLabelContext);
}
