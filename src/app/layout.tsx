import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Refeições AFA",
  description: "Sistema de marcação de refeições opcionais — Academia da Força Aérea",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#112244",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
