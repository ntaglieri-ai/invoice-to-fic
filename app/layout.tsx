import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Invoice to FIC",
  description: "Dashboard temporanea per preparare fatture estere SaaS verso Fatture in Cloud.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body className={`${inter.variable} bg-fog text-ink antialiased`}>{children}</body>
    </html>
  );
}
