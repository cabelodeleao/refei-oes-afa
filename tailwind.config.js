/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      colors: {
        navy: {
          900: "#0b1730",
          800: "#112244",
          700: "#1a2f57",
          600: "#1e3a6e",
          500: "#2b4d8a",
          400: "#3f64a6",
          300: "#6a8bc2",
          200: "#aac0de",
          100: "#d6e2f0",
          50: "#eef3fb",
        },
      },
      boxShadow: {
        card: "0 10px 30px -12px rgba(17, 34, 68, 0.25)",
        "card-hover": "0 18px 40px -14px rgba(17, 34, 68, 0.35)",
        glass: "0 20px 50px -20px rgba(0, 0, 0, 0.55)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-down": {
          "0%": { opacity: "0", transform: "translateY(-8px)", maxHeight: "0" },
          "100%": { opacity: "1", transform: "translateY(0)", maxHeight: "1500px" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "toast-in": {
          "0%": { opacity: "0", transform: "translateY(-16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "toast-out": {
          "0%": { opacity: "1", transform: "translateY(0)" },
          "100%": { opacity: "0", transform: "translateY(-16px)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out",
        "fade-in-up": "fade-in-up 0.35s ease-out both",
        "slide-down": "slide-down 0.3s ease-out",
        "scale-in": "scale-in 0.2s ease-out",
        "toast-in": "toast-in 0.28s ease-out",
        "toast-out": "toast-out 0.28s ease-in forwards",
      },
    },
  },
  plugins: [],
};
