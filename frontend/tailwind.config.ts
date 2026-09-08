import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#0b0b0b', 2: '#52514e', muted: '#898781' },
        plane: '#f4f4f1',
        surface: { DEFAULT: '#fcfcfb', 2: '#f7f7f4', sunken: '#eeeeea' },
        line: { DEFAULT: '#e1e0d9', strong: '#c9c8c0' },
        accent: { DEFAULT: '#2a78d6', soft: '#e8f0fc' },
        good: { DEFAULT: '#0ca30c', soft: '#e6f5e6' },
        warning: { DEFAULT: '#fab219', soft: '#fdf3dd' },
        serious: { DEFAULT: '#ec835a', soft: '#fceee7' },
        critical: { DEFAULT: '#d03b3b', soft: '#fbe9e9' },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(11, 11, 11, 0.06)',
        ribbon: '0 18px 48px rgba(11, 11, 11, 0.18)',
      },
    },
  },
  plugins: [],
}

export default config
