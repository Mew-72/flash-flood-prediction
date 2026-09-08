import AdminConsole from "./pages/AdminConsole";
import Dashboard from "./pages/Dashboard";

export default function App({ page }) {
  return page === "admin" ? <AdminConsole /> : <Dashboard />;
}
