// Точка входа автономной сборки симулятора (без «БАС Арены» и бэкенда).
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import Simulator from "@/pages/Simulator";
import "@/index.css";

createRoot(document.getElementById("root")!).render(
  <MemoryRouter>
    <Simulator />
  </MemoryRouter>,
);
