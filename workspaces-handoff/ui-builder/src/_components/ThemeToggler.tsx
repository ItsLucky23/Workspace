import { useState } from "react";

export default function ThemeToggler() {

  const [theme, setTheme] = useState<"light" | "dark">("dark");

  //? on default we set the theme to the session of the user but we allow to change it using a useState hook
  //? reason for this is that the settings page can display how it looks in the differnt theme without needing to call the server to update the sesion if the user hasnt clicked save yet
  const updateTheme = (newTheme: string) => {
    setTheme(newTheme == 'light' ? newTheme : "dark");
    document.documentElement.classList.toggle("dark", !(newTheme == "light"));
  };

  return { theme, updateTheme };
}