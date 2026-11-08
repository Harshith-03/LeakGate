import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { IconBadge } from "./ui";

type Tone = "info" | "good" | "warn" | "crit";
interface Toast { id: number; tone: Tone; title: string; body?: string }

const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(Ctx);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = nextId++;
    setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 3800);
  }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col gap-2 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[360px]"
        aria-live="polite"
      >
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="pointer-events-auto flex items-start gap-3 rounded-panel border border-line bg-surface px-3.5 py-3 shadow-lg"
              role="status"
            >
              <IconBadge size="sm" tone={t.tone}>
                {t.tone === "good" ? <CheckCircle2 size={15} /> : t.tone === "warn" || t.tone === "crit" ? <AlertTriangle size={15} /> : <Info size={15} />}
              </IconBadge>
              <div className="min-w-0 pt-0.5">
                <div className="text-[13.5px] font-semibold text-ink">{t.title}</div>
                {t.body && <div className="mt-0.5 line-clamp-3 text-caption text-ink-3">{t.body}</div>}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
