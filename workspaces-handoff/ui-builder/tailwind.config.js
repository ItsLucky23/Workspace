// tailwind.config.js
module.exports = {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./container-safelist.txt",
  ],
  theme: {
    extend: {
      colors: {}
    },
  },
  plugins: [
    require("@tailwindcss/typography"),
  ],
};