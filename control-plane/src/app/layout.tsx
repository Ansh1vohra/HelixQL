import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HelixQL",
  description: "Natural-language business intelligence, without your data ever leaving your firewall.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
