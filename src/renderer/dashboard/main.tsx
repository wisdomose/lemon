// Dashboard window entry: no document and no drawing engine, just the file lists and the prompt starter.
import "../theme.css";
import { createRoot } from "react-dom/client";
import { applyTheme } from "../settings.js";
import { Dashboard } from "./Dashboard.js";

applyTheme();
createRoot(document.getElementById("root")!).render(<Dashboard />);
requestAnimationFrame(() => requestAnimationFrame(() => document.body.setAttribute("data-ready", "1")));
