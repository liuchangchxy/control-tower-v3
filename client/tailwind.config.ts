export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0a0a0b',
          secondary: '#111113',
          tertiary: '#18181b',
          hover: '#1e1e21',
        },
        border: {
          DEFAULT: '#27272a',
          hover: '#3f3f46',
        },
        text: {
          primary: '#fafafa',
          secondary: '#a1a1aa',
          muted: '#71717a',
        },
        accent: '#3b82f6',
      },
      borderRadius: {
        DEFAULT: '8px',
        lg: '12px',
      },
    },
  },
  plugins: [],
};
