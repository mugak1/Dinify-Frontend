/** @type {import('tailwindcss').Config} */
const mode = process.env.TAILWIND_MODE ? 'jit' : 'aot';
module.exports = {
  mode:'jit',
  content: ["./src/**/*.{html,ts}"],
  theme: {
    extend: {
      colors: {
        'd-red': '#FF2C32',
      },
    },
  },
  plugins: [],
}

