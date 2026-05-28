import { useRef } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

const OPTS = { enableOnFormTags: false, preventDefault: false };
const OPTS_PD = { enableOnFormTags: false, preventDefault: true };

export function useAppHotkeys({
  navigate,
  applyPreset,
  loadMetrics,
  closeDrawer,
  toggleShortcuts,
}) {
  const gMode   = useRef(false);
  const gTimer  = useRef(null);

  function armG() {
    gMode.current = true;
    clearTimeout(gTimer.current);
    gTimer.current = setTimeout(() => { gMode.current = false; }, 1200);
  }

  function withG(tab) {
    return () => {
      if (!gMode.current) return;
      gMode.current = false;
      clearTimeout(gTimer.current);
      navigate(tab);
    };
  }

  // "g" leader key
  useHotkeys('g', armG, OPTS);

  // g+letter → navigate
  useHotkeys('o', withG('overview'),         OPTS);
  useHotkeys('c', withG('campaigns'),        OPTS);
  useHotkeys('b', withG('brand-analytics'),  OPTS);
  useHotkeys('a', withG('alerts'),           OPTS);
  useHotkeys('r', withG('reports'),          OPTS);

  // l → load metrics with current date range
  useHotkeys('l', () => { gMode.current = false; loadMetrics(); }, OPTS);

  // 1–4 → date presets
  useHotkeys('1', () => { gMode.current = false; applyPreset('L7');  }, OPTS);
  useHotkeys('2', () => { gMode.current = false; applyPreset('L30'); }, OPTS);
  useHotkeys('3', () => { gMode.current = false; applyPreset('MTD'); }, OPTS);
  useHotkeys('4', () => { gMode.current = false; applyPreset('YTD'); }, OPTS);

  // Escape → close drawer
  useHotkeys('escape', closeDrawer, OPTS);

  // ? → shortcuts overlay
  useHotkeys('?', () => { gMode.current = false; toggleShortcuts(); }, OPTS_PD);
}
