import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Led } from "./crt";
import { IconBadge } from "./ui";

type Tone = "info" | "good" | "warn" | "crit";
interface Toast { id: number; tone: Tone; title: string; body?: string }

const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(Ctx);

let nextId = 1;
const LED = { info: "info", good: "ok", warn: "warn", crit: "alarm" } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = nextId++;
    setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 4200);
  }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      {/* above the phone's bottom key row; bottom-right on wider screens */}
      <div
        className="pointer-events-none fixed inset-x-3 bottom-[88px] z-[60] flex flex-col gap-2.5 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[380px]"
        aria-live="polite"
      >
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="crt pointer-events-auto"
              data-tone={t.tone === "crit" ? "crit" : t.tone === "warn" ? "warn" : t.tone === "good" ? "good" : "info"}
              data-glow={t.tone === "crit" ? "" : undefined}
              style={{ padding: 6, borderRadius: 14 }}
              role="status"
            >
              <div className="crt-screen" style={{ borderRadius: 10 }}>
                <div className="crt-body flex items-start gap-3 px-3.5 py-3">
                  <IconBadge size="sm" tone={t.tone}>
                    {t.tone === "good" ? <CheckCircle2 size={15} /> : t.tone === "warn" || t.tone === "crit" ? <AlertTriangle size={15} /> : <Info size={15} />}
                  </IconBadge>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
                      <span className="min-w-0 flex-1 break-words">{t.title}</span>
                      <Led state={LED[t.tone]} blink={t.tone === "crit"} size="sm" />
                    </div>
                    {t.body && <div className="mt-0.5 line-clamp-3 text-caption text-ink-3">{t.body}</div>}
                  </div>
                </div>
                <div className="crt-fx" aria-hidden />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
