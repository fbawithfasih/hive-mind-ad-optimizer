import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import CommandPalette from './CommandPalette.jsx';

const Ctx = createContext(null);

export function useCommandPalette() {
  return useContext(Ctx);
}

export function CommandPaletteProvider({ children }) {
  const [open, setOpen] = useState(false);
  const actionsRef = useRef({});

  useHotkeys('mod+k', (e) => { e.preventDefault(); setOpen(o => !o); }, {
    enableOnFormTags: false,
    preventDefault: true,
  });

  const registerActions = useCallback((actions) => {
    actionsRef.current = actions;
  }, []);

  const openPalette = useCallback(() => setOpen(true), []);

  return (
    <Ctx.Provider value={{ open, setOpen, openPalette, registerActions }}>
      {children}
      <CommandPalette open={open} onOpenChange={setOpen} actionsRef={actionsRef} />
    </Ctx.Provider>
  );
}
