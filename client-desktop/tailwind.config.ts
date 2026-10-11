import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/renderer/index.html", "./src/renderer/src/**/*.{ts,tsx}"],
  theme: {
    // One step larger than Tailwind's defaults across the board: the stock
    // 12px `text-xs` was too small to read comfortably in a dense desktop
    // UI. Sizing lives here, not in components, so it can be tuned in one
    // place.
    fontSize: {
      "2xs": ["0.8125rem", { lineHeight: "1.125rem" }], // 13px — captions, metadata
      xs: ["0.875rem", { lineHeight: "1.25rem" }], // 14px — labels, grids
      sm: ["1rem", { lineHeight: "1.5rem" }], // 16px — body, inputs, buttons
      base: ["1.0625rem", { lineHeight: "1.625rem" }], // 17px
      lg: ["1.1875rem", { lineHeight: "1.75rem" }], // 19px
      xl: ["1.375rem", { lineHeight: "1.875rem" }], // 22px
      "2xl": ["1.625rem", { lineHeight: "2.125rem" }], // 26px
    },
    extend: {
      colors: {
        brand: {
          50: "#eefdfb",
          100: "#d1faf3",
          200: "#a5f1e6",
          300: "#6de3d5",
          400: "#2dd4bf",
          500: "#14b8a6",
          600: "#0d9488",
          700: "#0f766e",
          800: "#115e59",
          900: "#0f172a",
          950: "#08111f",
        },
      },
    },
  },
  plugins: [],
};

export default config;
