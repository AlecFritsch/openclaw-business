"use client";

import { useRouter } from "next/navigation";
import { X, Sparkles, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "motion/react";

interface AgentCreationChoiceProps {
  open: boolean;
  onClose: () => void;
}

export function AgentCreationChoice({ open, onClose }: AgentCreationChoiceProps) {
  const router = useRouter();
  const t = useTranslations('agents');

  const handleChoice = (path: string) => {
    onClose();
    router.push(path);
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="relative bg-card border border-border rounded-2xl max-w-md w-full p-6 space-y-4"
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-gray-400 hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" strokeWidth={2} />
            </button>

            <div>
              <h2 className="text-lg font-medium">Neuer Agent</h2>
              <p className="text-xs text-muted-foreground mt-1">Wie möchtest du starten?</p>
            </div>

            <div className="space-y-2.5">
              <button
                onClick={() => handleChoice('/agents/builder')}
                className="w-full flex items-center gap-3.5 p-4 border-2 border-foreground/80 rounded-xl hover:bg-foreground/[0.03] transition-colors text-left group"
              >
                <div className="w-9 h-9 bg-foreground text-primary-foreground rounded-lg flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-medium">Mit AI erstellen</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Beschreibe was dein Agent tun soll</div>
                </div>
              </button>

              <button
                onClick={() => handleChoice('/templates')}
                className="w-full flex items-center gap-3.5 p-4 border border-border rounded-xl hover:border-foreground/20 transition-colors text-left group"
              >
                <div className="w-9 h-9 bg-muted rounded-lg flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-sm font-medium">Vorlage verwenden</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Starte mit einem fertigen Template</div>
                </div>
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
