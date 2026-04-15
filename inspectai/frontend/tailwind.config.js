/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        // Mapped to CSS variables — works in both dark and light mode
        bg: {
          DEFAULT: 'var(--bg)',
          2: 'var(--bg2)',
          3: 'var(--bg3)',
          4: 'var(--bg4)',
        },
        border: {
          DEFAULT: 'var(--border)',
          2: 'var(--border2)',
          3: 'var(--border3)',
        },
        text: {
          DEFAULT: 'var(--text)',
          2: 'var(--text2)',
          3: 'var(--text3)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          2: 'var(--accent2)',
          bg: 'var(--accent-bg)',
          bd: 'var(--accent-bd)',
        },
        success: {
          DEFAULT: 'var(--green)',
          bg: 'var(--green-bg)',
          border: 'var(--green-border)',
        },
        danger: {
          DEFAULT: 'var(--red)',
          bg: 'var(--red-bg)',
          border: 'var(--red-border)',
        },
        warning: {
          DEFAULT: 'var(--amber)',
          bg: 'var(--amber-bg)',
          border: 'var(--amber-border)',
        },
        violet: {
          DEFAULT: 'var(--purple)',
          bg: 'var(--purple-bg)',
          border: 'var(--purple-border)',
        },
        info: {
          DEFAULT: 'var(--teal)',
          bg: 'var(--teal-bg)',
          border: 'var(--teal-border)',
        },
      },
      borderRadius: {
        DEFAULT: '7px',
        sm: '5px',
        md: '8px',
        lg: '10px',
        xl: '12px',
      },
      boxShadow: {
        DEFAULT: 'var(--shadow)',
        lg: 'var(--shadow-lg)',
      },
      width: {
        sidebar: '220px',
      },
    },
  },
  plugins: [],
}
