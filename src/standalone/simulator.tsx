// Точка входа автономной сборки симулятора (без «БАС Арены» и бэкенда).
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import Simulator from "@/pages/Simulator";
import "@/index.css";
// шрифты интерфейса вшиты в сборку — настольная версия работает без интернета
import "@fontsource/russo-one/400.css";
import "@fontsource/orbitron/400.css";
import "@fontsource/orbitron/700.css";
import "@fontsource/orbitron/900.css";
import "@fontsource/rajdhani/400.css";
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";

createRoot(document.getElementById("root")!).render(
  <MemoryRouter>
    <Simulator />
  </MemoryRouter>,
);
