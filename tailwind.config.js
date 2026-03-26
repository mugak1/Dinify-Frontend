/** @type {import('tailwindcss').Config} */
const mode = process.env.TAILWIND_MODE ? 'jit' : 'aot';
module.exports = {
  mode:'jit',
  content: ["./src/**/*.{html,ts}"],
  theme: {
    extend: {
      colors: {
        'd-red': '#FF2C32',
        'primary': '#FF2C32',
        'primary-foreground': '#FFFFFF',
        'muted': '#F1F5F9',
        'muted-foreground': '#64748B',
        'border': '#E2E8F0',
        'destructive': '#EF4444',
        'card': '#FFFFFF',
        'background': '#F8FAFC',
      },
      backgroundImage: {
        'fade': 'linear-gradient(to right, white, rgba(0, 0, 0, 0))',
      }
    },
    FontFamily:{
      montserrat:['Montserrat']
    },
    fontWeight: {
      hairline: 100,
      'extra-light': 100,
      thin: 200,
       light: 300,
       normal: 400,
       medium: 500,
      semibold: 600,
       bold: 700,
      extrabold: 800,
      'extra-bold': 800,
       black: 900,
     }
  },
  plugins: [],
}

