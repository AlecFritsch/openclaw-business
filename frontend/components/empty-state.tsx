"use client";

import { motion } from "motion/react";

interface EmptyStateProps {
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-20 px-6 text-center"
    >
      <div className="w-20 h-20 border-2 border-border rounded-2xl flex items-center justify-center mb-8 relative">
        <div className="w-10 h-10 border-2 border-gray-300 dark:border-border rounded-lg" />
        <div className="absolute inset-0 border-2 border-border/60 rounded-3xl scale-150 opacity-50" />
      </div>
      <h3 className="text-lg font-medium mb-3">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-md mb-8 leading-relaxed">{description}</p>
      {action && (
        <button onClick={action.onClick} className="btn-primary-sm px-6">
          {action.label}
        </button>
      )}
    </motion.div>
  );
}
