import { useEffect } from 'react';
import { useMotionValue, useSpring, useTransform } from 'framer-motion';

// Returns a framer-motion MotionValue that springs toward `target`.
// Pass a formatFn to get a formatted string MotionValue instead of raw number.
export function useTickerAnimation(target, formatFn) {
  const raw = useMotionValue(target ?? 0);
  const spring = useSpring(raw, { stiffness: 110, damping: 22, mass: 0.8 });

  useEffect(() => {
    raw.set(target ?? 0);
  }, [target, raw]);

  if (formatFn) {
    return useTransform(spring, v => formatFn(v));
  }
  return spring;
}
