import React from 'react';
import { motion } from 'framer-motion';

export default function DrawerOverlay({ onClose }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg-overlay-lo)',
        backdropFilter: 'blur(4px)',
        zIndex: 99,
      }}
    />
  );
}
