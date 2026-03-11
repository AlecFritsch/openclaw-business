"use client";

import { Navbar } from "@/components/navbar";

interface AppShellProps {
  children: React.ReactNode;
  className?: string;
  /** Max-width container. Defaults to max-w-7xl */
  maxWidth?: "max-w-5xl" | "max-w-6xl" | "max-w-7xl" | "max-w-full";
  /** Remove default padding */
  noPadding?: boolean;
  /** Embedded design: navbar + content in one rounded, shadowed container (agent pages) */
  embedded?: boolean;
}

/**
 * Consistent app shell for authenticated pages.
 * Wraps content with Navbar and standardised container.
 * Use embedded=true for agent pages (workspace, overview, configure, etc.).
 */
export function AppShell({ 
  children, 
  className = "",
  maxWidth = "max-w-7xl",
  noPadding = false,
  embedded = false,
}: AppShellProps) {
  const mainClass = `${maxWidth} mx-auto ${noPadding ? '' : 'px-4 sm:px-6 py-6 sm:py-8'} ${className}`;
  const embeddedMainClass = `flex-1 overflow-auto w-full ${noPadding ? '' : 'px-4 sm:px-5 py-4 sm:py-5'} ${className}`;

  if (embedded) {
    return (
      <div className="min-h-screen flex flex-col bg-background p-1 md:p-2">
        <div className="flex-1 flex flex-col min-h-0 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.06),0_4px_16px_rgba(0,0,0,0.04),0_0_0_0.5px_rgba(0,0,0,0.04)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.4),0_4px_16px_rgba(0,0,0,0.3),0_0_0_0.5px_rgba(255,255,255,0.06)] border border-border/40 overflow-hidden bg-card">
          <Navbar embedded />
          <main className={embeddedMainClass}>
            {children}
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className={mainClass}>
        {children}
      </main>
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

/**
 * Consistent page header with title, description, and optional actions.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6 sm:mb-8">
      <div>
        <h1 className="text-xl sm:text-2xl font-medium">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
