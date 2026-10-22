/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        tie: {
          bg: "var(--tie-bg)",
          surface: "var(--tie-surface)",
          subtle: "var(--tie-subtle)",
          card: "var(--tie-card)",
          border: "var(--tie-border)",
          accent: "var(--tie-accent)",
          blue: "var(--tie-blue)",
          emerald: "var(--tie-emerald)",
          amber: "var(--tie-amber)",
          danger: "var(--tie-danger)",
          muted: "var(--tie-muted)",
          text: "var(--tie-text)",
          hover: "var(--tie-hover)",
          overlay: "var(--tie-overlay)",
          titlebar: "var(--tie-titlebar)",
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
