import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "AI Pro Camera", description: "Scene-aware camera settings using real browser camera controls." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#000000" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
