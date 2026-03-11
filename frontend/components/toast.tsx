"use client";

import { motion, AnimatePresence } from "motion/react";
import { useEffect, useState } from "react";

interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}

let toastId = 0;
const toasts: Toast[] = [];
const listeners: ((toasts: Toast[]) => void)[] = [];

export function showToast(message: string, type: Toast["type"] = "info") {
  const toast: Toast = {
    id: String(toastId++),
    message,
    type,
  };
  toasts.push(toast);
  listeners.forEach((listener) => listener([...toasts]));

  setTimeout(() => {
    const index = toasts.findIndex((t) => t.id === toast.id);
    if (index > -1) {
      toasts.splice(index, 1);
      listeners.forEach((listener) => listener([...toasts]));
    }
  }, 3000);
}

export function ToastContainer() {
  const [toastList, setToastList] = useState<Toast[]>([]);

  useEffect(() => {
    listeners.push(setToastList);
    return () => {
      const index = listeners.indexOf(setToastList);
      if (index > -1) listeners.splice(index, 1);
    };
  }, []);

  return (
    <div className="fixed bottom-6 right-6 z-50 space-y-2">
      <AnimatePresence>
        {toastList.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={`px-4 py-3 border rounded-lg bg-card shadow-lg min-w-[300px] ${
              toast.type === "error"
                ? "border-red-300 dark:border-red-700"
                : toast.type === "success"
                ? "border-green-300 dark:border-green-700"
                : "border-gray-300 dark:border-border"
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`w-2 h-2 rounded-full ${
                  toast.type === "error"
                    ? "bg-red-500"
                    : toast.type === "success"
                    ? "bg-green-500"
                    : "bg-gray-500 dark:bg-gray-400"
                }`}
              />
              <span className="text-sm">{toast.message}</span>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
