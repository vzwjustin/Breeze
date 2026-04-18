import type { ReactNode } from "react";

export const metadata = {
  title: "Breeze",
  description: "Your calm AI assistant.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Skip-nav: global CSS should define .sr-only as visually hidden */}
        <a href="#main-content" className="sr-only">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
