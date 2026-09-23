import type { Metadata } from "next";
import { AppNav } from "../components/app-nav";
import "./globals.css";
import "../components/pr17-global.css";
import "../components/pr21-global.css";
import "../components/pr24-global.css";

export const metadata: Metadata = {
  title: "Market Intelligence",
  description:
    "Panel público en español de derivados, liquidaciones, macroeconomía y noticias relevantes para crypto y mercados",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <AppNav />
        {children}
      </body>
    </html>
  );
}
