import type { Metadata } from "next";
import { ApplicationGate } from "@/components/ApplicationGate";
import "@cloudscape-design/global-styles/index.css";
import "@xyflow/react/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "D2D Operations",
  description: "A local-first engineering console for tracked GitHub repositories",
  icons: { icon: "/doug-lg.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="awsui-dark-mode awsui-visual-refresh"><ApplicationGate>{children}</ApplicationGate></body>
    </html>
  );
}
