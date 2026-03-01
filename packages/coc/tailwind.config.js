/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/server/spa/client/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      screens: {
        'sm': '640px',
        'md': '768px',
        'lg': '1024px',
      },
      keyframes: {
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
