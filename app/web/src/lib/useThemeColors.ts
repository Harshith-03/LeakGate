import { useMemo } from "react";
import { useApp } from "../state/app";

/** Resolve CSS tokens to concrete colours for SVG chart attributes; recomputed when the theme flips. */
export function useThemeColors<K extends string>(names: readonly K[]): Record<K, string> {
  const { theme } = useApp();
  return useMemo(() => {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(`--${n}`).trim() || "#888"])) as Record<K, string>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, names.join("|")]);
}
