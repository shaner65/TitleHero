// src/App.tsx
import { useState } from "react";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Admin from "./pages/Admin";

type View = "login" | "main" | "admin";

export default function App() {
  const [view, setView] = useState<View>("login");
  
  if (view === "login") {
    return <Login onEnter={() => setView("main")} />;
  }
  
  if (view === "admin") {
    return <Admin onBack={() => setView("main")} />;
  }
  
  return <Dashboard onNavigateToAdmin={() => setView("admin")} />;
}
