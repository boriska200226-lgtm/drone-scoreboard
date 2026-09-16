import { useEffect, useRef, useState } from "react";

/**
 * Число, которое доезжает до нового значения, а не перескакивает.
 *
 * Начисление СЗ — главный момент игры; если счётчик просто меняет цифру,
 * он ничем не отличается от таблицы успеваемости.
 */
export function useCountUp(target: number, duration = 700): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number>();

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return undefined;

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic: быстро стартует, мягко замирает на конечном числе
      const eased = 1 - (1 - t) ** 3;
      const next = Math.round(from + (target - from) * eased);
      setValue(next);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      fromRef.current = target;
    };
  }, [target, duration]);

  return value;
}

/** Предыдущее значение — чтобы понять, какие клетки шкалы только что зажглись. */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}
