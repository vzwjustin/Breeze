import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Breeze — AI Assistant",
  description: "Your calm AI assistant. Chat, automate, and act.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main-content" className="sr-only">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
