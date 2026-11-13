/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#0D0737', 50: '#E9E8F1', 100: '#C9C6DE', 700: '#140C4A', 800: '#0D0737', 900: '#080423' },
        royal: { DEFAULT: '#21165F', 50: '#ECEAF5', 100: '#D3CEEA', 500: '#3A2D8C', 600: '#2C2075', 700: '#21165F' },
        gold: { DEFAULT: '#B8A66A', 50: '#F8F5EA', 100: '#EFE8D1', 200: '#DFD3AA', 300: '#CDBE88', 400: '#B8A66A', 500: '#9E8B4E', 600: '#7D6D3C' },
        ivory: { DEFAULT: '#F7F4EC', 100: '#FBFAF6', 200: '#F7F4EC', 300: '#ECE6D6' },
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(13,7,55,0.04), 0 4px 16px rgba(13,7,55,0.06)',
        gold: '0 0 0 3px rgba(184,166,106,0.35)',
      },
      borderRadius: { xl: '0.875rem' },
    },
  },
  plugins: [],
};
