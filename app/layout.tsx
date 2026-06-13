import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PR Review Harness",
  description: "AI-assisted PR review with multi-agent orchestration",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-950 text-gray-100 antialiased">
        <header className="border-b border-gray-800 bg-gray-900 px-6 py-4">
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <span className="text-xl font-semibold tracking-tight">
              PR Review Harness
            </span>
            <span className="rounded bg-indigo-900 px-2 py-0.5 text-xs font-medium text-indigo-300">
              BETA
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
