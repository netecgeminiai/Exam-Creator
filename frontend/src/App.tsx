import { Routes, Route, Navigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import SimulatorPage from "./pages/SimulatorPage";
import AdminPage from "./pages/AdminPage";
import "./App.css";

export default function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/simulator" element={<SimulatorPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/question/:questionNumber" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
