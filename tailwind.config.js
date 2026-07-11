const plugin = require('tailwindcss/plugin');
const defaultTheme = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  mode: 'jit',
  content: ["./src/**/*.{html,ts}"],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans Variable"', ...defaultTheme.fontFamily.sans],
        display: ['"Bricolage Grotesque Variable"', '"Plus Jakarta Sans Variable"', ...defaultTheme.fontFamily.sans],
        gabarito: ['"Gabarito Variable"', '"Plus Jakarta Sans Variable"', ...defaultTheme.fontFamily.sans],
      },
      colors: {
        'd-red': '#FF2C32',
        // Brand-red companions from the Order Review handoff (§2). Kept as
        // explicit brand tokens alongside d-red (the codebase's existing one-off
        // brand hex) rather than inline hexes: hover/pressed red for the submit
        // button, and the soft tint behind a selected review chip.
        'd-red-hover': '#E61C22',
        'd-red-soft': '#FFE8E8',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          hover: 'hsl(var(--primary-hover))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          3: 'hsl(var(--chart-3))',
          4: 'hsl(var(--chart-4))',
          5: 'hsl(var(--chart-5))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        // The diner dish-card corner (replaces the arbitrary rounded-[20px]).
        card: '20px',
      },
      fontSize: {
        // Semantic type scale, px-fixed: the 14px html root renders rem-based
        // text-* utilities ~12.5% under their nominal size, which is what bred
        // the one-off text-[..px] (and half-pixel) values across the app. New
        // text picks one of these roles — no new arbitrary text-[..px].
        'page-title': ['26px', { lineHeight: '32px', fontWeight: '700' }],
        'section-title': ['18px', { lineHeight: '26px', fontWeight: '600' }],
        'card-title': ['15px', { lineHeight: '22px', fontWeight: '600' }],
        'body': ['13px', { lineHeight: '20px' }],
        'caption': ['12px', { lineHeight: '16px' }],
        // 11px is the hard floor — nothing renders smaller than this.
        'micro': ['11px', { lineHeight: '14px' }],
      },
      backgroundImage: {
        'fade': 'linear-gradient(to right, white, rgba(0, 0, 0, 0))',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
      boxShadow: {
        'glow':       '0 6px 18px -4px rgba(255,44,50,0.42), 0 2px 6px -2px rgba(255,44,50,0.30)',
        'glow-lg':    '0 10px 30px -6px rgba(255,44,50,0.55), 0 3px 10px -3px rgba(255,44,50,0.38)',
        'glow-green': '0 6px 18px -4px rgba(34,197,94,0.38), 0 2px 6px -2px rgba(34,197,94,0.26)',
      },
    },
  },
  plugins: [
    plugin(({ addVariant }) => {
      // Hover styles that apply only on devices with a hover-capable, fine pointer
      // (desktop/laptop). On touch, `(hover: hover)` is false so these never stick after a tap.
      addVariant('desktop-hover', '@media (hover: hover) and (pointer: fine) { &:hover }');
    }),
  ],
};
