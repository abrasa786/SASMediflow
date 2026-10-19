import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // The accent scale reads CSS variables so each clinic's brand colour can retheme every screen (src/lib/theme.ts).
        sky: {
        50: "rgb(var(--sky-50) / <alpha-value>)",
        100: "rgb(var(--sky-100) / <alpha-value>)",
        200: "rgb(var(--sky-200) / <alpha-value>)",
        300: "rgb(var(--sky-300) / <alpha-value>)",
        400: "rgb(var(--sky-400) / <alpha-value>)",
        500: "rgb(var(--sky-500) / <alpha-value>)",
        600: "rgb(var(--sky-600) / <alpha-value>)",
        700: "rgb(var(--sky-700) / <alpha-value>)",
        800: "rgb(var(--sky-800) / <alpha-value>)",
        900: "rgb(var(--sky-900) / <alpha-value>)",
        950: "rgb(var(--sky-950) / <alpha-value>)"
        },
      },
    },
  },
  plugins: [],
};
export default config;
