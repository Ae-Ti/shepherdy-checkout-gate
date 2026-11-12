import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lumen Trails — book local experiences",
  description: "A demo booking site whose PayPal checkout is verified by Shepherdy Checkout Gate.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="sandbox-bar">PayPal sandbox demo · no real money moves</div>
        <header className="header">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden>◐</span> Lumen Trails
          </Link>
          <span className="header-note">Small-group experiences, booked in a minute</span>
        </header>
        <main className="main">{children}</main>
        <footer className="footer">
          Checkout released only after <strong>Shepherdy Checkout Gate</strong> verified it against PayPal&apos;s own records.
        </footer>
      </body>
    </html>
  );
}
