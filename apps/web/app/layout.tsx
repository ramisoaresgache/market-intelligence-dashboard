import type { Metadata } from "next";
import { AppNav } from "../components/app-nav";
import "./globals.css";

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
