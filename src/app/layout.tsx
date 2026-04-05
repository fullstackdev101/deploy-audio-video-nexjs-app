import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });

export const metadata: Metadata = {
  title: "PeerLink — Encrypted P2P Communication",
  description:
    "Production-ready 1-to-1 video call and text chat platform using WebRTC, PeerJS, and Next.js.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={geist.variable}>
      <body className="antialiased bg-slate-950 text-white">{children}</body>
    </html>
  );
}
