/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        card: 'rgba(26, 29, 36, 0.72)',
        stroke: '#2c313c',
        accent: '#e1306c',
        accent2: '#c13584',
        accent3: '#f77737',
        ink: '#11141a',
        muted: '#9aa1ad',
        ok: '#51cf66',
        err: '#ff6b6b',
      },
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'none' },
        },
        shimmer: {
          from: { backgroundPosition: '200% 0' },
          to: { backgroundPosition: '-120% 0' },
        },
        dlpop: {
          '0%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.04)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        rise: 'rise 0.45s ease both',
        shimmer: 'shimmer 1.4s ease-in-out infinite',
        dlpop: 'dlpop 0.4s cubic-bezier(0.18, 0.89, 0.32, 1.28) both',
      },
    },
  },
  plugins: [],
};
