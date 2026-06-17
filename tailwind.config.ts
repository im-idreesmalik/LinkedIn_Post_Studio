import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/email/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#0a66c2", // LinkedIn blue
          dark: "#004182",
          light: "#e8f1fb",
        },
        canvas: "#f4f2ee", // LinkedIn-style page background
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.06)",
        lift: "0 4px 12px rgba(0,0,0,0.08)",
      },
    },
  },
  plugins: [],
} satisfies Config;
