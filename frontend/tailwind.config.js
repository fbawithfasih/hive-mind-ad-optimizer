export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink:     '#0F172A',
        surface: '#1E293B',
        card:    '#263348',
        border:  '#334155',
        muted:   '#94A3B8',
        gold:    '#F59E0B',
        ivory:   '#F1F5F9',
        blue:    '#3B82F6',
        purple:  '#8B5CF6',
        emerald: '#10B981',
        rose:    '#F43F5E',
        // legacy
        darkInk: '#0F172A',
        walnut:  '#263348',
      },
      keyframes: {
        fadeIn:  { '0%': { opacity: '0', transform: 'translateY(8px)' },  '100%': { opacity: '1', transform: 'translateY(0)' } },
        slideIn: { '0%': { opacity: '0', transform: 'translateX(-12px)' }, '100%': { opacity: '1', transform: 'translateX(0)' } },
      },
      animation: {
        fadeIn:  'fadeIn 0.3s ease-out both',
        slideIn: 'slideIn 0.25s ease-out both',
      },
    },
  },
  plugins: [],
}
