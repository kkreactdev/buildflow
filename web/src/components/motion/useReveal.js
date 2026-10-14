import { useEffect, useRef, useState } from 'react';

const reduced = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * AOS-style "reveal once when scrolled into view", without a dependency. Returns [ref, shown].
 * Where IntersectionObserver is missing (tests, very old browsers) or the user prefers reduced motion, content is shown at once,
 * so nothing is ever left invisible.
 */
export function useReveal({ threshold = 0.12 } = {}) {
  const ref = useRef(null);
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined' || reduced());
  useEffect(() => {
    const el = ref.current;
    if (shown || !el) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin: '0px 0px -4% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, threshold]);
  return [ref, shown];
}
