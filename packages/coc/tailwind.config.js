/** @type {import('tailwindcss').Config} */
export default {
  // tiptap-react's toolbar and TOC panel style themselves with Tailwind
  // utilities, so the SPA build must scan their source too.
  content: ['./src/server/spa/client/**/*.{ts,tsx}', '../tiptap-react/src/**/*.{ts,tsx}'],
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
