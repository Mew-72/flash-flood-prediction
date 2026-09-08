import { Navigate, Route, Routes } from "react-router-dom";

import AdminConsole from "./pages/AdminConsole";
import Dashboard from "./pages/Dashboard";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/admin" element={<AdminConsole />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
