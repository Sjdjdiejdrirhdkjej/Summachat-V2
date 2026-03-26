import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

document.documentElement.classList.toggle(
  "dark",
  window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false,
);
createRoot(document.getElementById("root")!).render(<App />);
