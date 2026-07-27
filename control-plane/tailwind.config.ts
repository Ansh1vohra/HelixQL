import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}"],
  theme: {
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
