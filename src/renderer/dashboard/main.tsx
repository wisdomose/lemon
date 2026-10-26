// Dashboard window entry: no document and no drawing engine, just the file lists and the prompt starter.
import "../theme.css";
import { createRoot } from "react-dom/client";
import { applyTheme } from "../settings.js";
import { Dashboard } from "./Dashboard.js";
import { TipProvider } from "../ui/kit.js";

applyTheme();
createRoot(document.getElementById("root")!).render(
  <TipProvider>
    <Dashboard />
  </TipProvider>,
);
requestAnimationFrame(() => requestAnimationFrame(() => document.body.setAttribute("data-ready", "1")));
