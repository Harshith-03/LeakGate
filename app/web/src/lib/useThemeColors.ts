import { useMemo } from "react";

/** Resolve CSS tokens to concrete colours for SVG chart attributes (the UI is dark only, so once is enough). */
export function useThemeColors<K extends string>(names: readonly K[]): Record<K, string> {
  return useMemo(() => {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(`--${n}`).trim() || "#888"])) as Record<K, string>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names.join("|")]);
}
