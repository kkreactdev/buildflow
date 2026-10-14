import { useEffect, useState } from 'react';
import { useReveal } from './useReveal';

const reduced = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Counts from 0 to the real value once, when first visible. The accessible name and the final text are always the exact value;
 * with reduced motion (or no IntersectionObserver) it is simply the value. It never shows a number the data does not hold.
 */
export function CountUp({ value, duration = 800, className }) {
  const [ref, shown] = useReveal({ threshold: 0.3 });
  const still = reduced() || typeof IntersectionObserver === 'undefined';
  const [shownValue, setShownValue] = useState(still ? value : 0);

  useEffect(() => {
    if (still) return undefined;
    if (!shown) return undefined;
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      setShownValue(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shown, value, duration, still]);

  const text = (still ? value : shownValue).toLocaleString('en-IN');
  return (
    <span ref={ref} className={className} aria-label={value.toLocaleString('en-IN')} style={{ minWidth: `${value.toLocaleString('en-IN').length}ch`, fontVariantNumeric: 'tabular-nums' }}>
      <span aria-hidden="true">{text}</span>
    </span>
  );
}
