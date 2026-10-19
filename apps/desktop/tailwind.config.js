/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        tie: {
          bg: "#ffffff",
          surface: "#f8fafc",
          subtle: "#f1f5f9",
          card: "#ffffff",
          border: "#e2e8f0",
          accent: "#0f172a",
          blue: "#0284c7",
          emerald: "#10b981",
          amber: "#d97706",
          danger: "#ef4444",
          muted: "#64748b",
          text: "#1e293b",
        },
      },
      fontFamily: {
        sans: [
          "Segoe UI",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "PingFang SC",
          "Microsoft YaHei",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Cascadia Code",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};
