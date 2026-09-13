import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#172033",
        fog: "#f6f7f9",
        line: "#d9dee8",
        mint: "#38a169",
        amber: "#b7791f",
        berry: "#b83280",
      },
      boxShadow: {
        panel: "0 16px 48px rgba(23, 32, 51, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
