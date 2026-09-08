import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";

import App from "./App";
import "./styles.css";

const page = window.location.pathname.toLowerCase().endsWith("admin.html")
  ? "admin"
  : "dashboard";

document.body.classList.toggle("admin-body", page === "admin");
createRoot(document.getElementById("root")).render(<App page={page} />);
