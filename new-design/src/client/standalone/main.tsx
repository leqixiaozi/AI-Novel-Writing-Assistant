import { createRoot } from "react-dom/client";
import { StandaloneLayout } from "./StandaloneLayout";
import { applyTheme, readTheme } from "./theme";
import "./theme.css";

applyTheme(readTheme());
const root = document.getElementById("root");
if (!root) throw new Error("无法找到工作台页面入口。");
createRoot(root).render(<StandaloneLayout />);
