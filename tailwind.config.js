/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(214 32% 91%)',
        background: 'hsl(0 0% 100%)',
        foreground: 'hsl(222 47% 11%)',
        muted: 'hsl(210 40% 96%)',
        'muted-foreground': 'hsl(215 16% 47%)',
        primary: 'hsl(222 47% 11%)',
        'primary-foreground': 'hsl(0 0% 100%)',
        accent: 'hsl(210 40% 96%)',
        'accent-foreground': 'hsl(222 47% 11%)',
        destructive: 'hsl(0 84% 60%)',
        'destructive-foreground': 'hsl(0 0% 100%)',
      },
    },
  },
  plugins: [],
};
