/**
 * @fileoverview Punto de entrada de **@theforge/web** (React + Vite): monta la aplicación Workshop y rutas
 * de autenticación en `#root` con `StrictMode`.
 *
 * @module main
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 * @author Jorge Correa <jcorrea@e-personal.net>
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./theme/ThemeProvider";
import "./plugin-ui/bootstrap";
import "./index.css";
import "katex/dist/katex.min.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
