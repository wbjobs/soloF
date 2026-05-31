/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        ink: {
          50: "#F7F3EC",
          100: "#ECE3D0",
          200: "#D8C9A5",
          500: "#4A4236",
          700: "#2A241B",
          900: "#14110C",
        },
        moss: {
          50: "#E9F5EF",
          100: "#C9E7D5",
          300: "#6FBF94",
          500: "#1F7A5A",
          600: "#196449",
          700: "#124B38",
        },
        amber2: {
          400: "#E0A040",
          500: "#D97706",
          600: "#B45309",
        },
      },
      fontFamily: {
        display: ['"Fraunces"', '"Noto Serif SC"', 'Georgia', 'serif'],
        sans: ['"Inter"', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        soft: "0 8px 24px -10px rgba(20, 17, 12, 0.18)",
        ring: "0 0 0 1px rgba(20,17,12,0.08), 0 10px 30px -10px rgba(20,17,12,0.25)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
        floaty: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-4px)" },
        },
        fadeIn: {
          from: { opacity: 0, transform: "translateY(6px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.6s linear infinite",
        floaty: "floaty 4s ease-in-out infinite",
        fadeIn: "fadeIn .35s ease-out both",
      },
    },
  },
  plugins: [],
};
