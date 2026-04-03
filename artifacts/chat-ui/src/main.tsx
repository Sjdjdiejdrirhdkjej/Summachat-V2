import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

/* Initial `dark` class is set by inline script in index.html (reads localStorage + system).
 * ThemeProvider from next-themes owns updates after mount. */
createRoot(document.getElementById("root")!).render(<App />);
