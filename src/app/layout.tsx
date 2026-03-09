import type { Metadata } from "next";
import { Outfit, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

// Display font — expressive headlines
const outfit = Outfit({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

// Mono font — for technical data (progress, file names)
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "BOMIS Watermark Studio",
  description: "High-performance batch watermarking for Google Drive — images and video",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${outfit.variable} ${jetbrainsMono.variable} antialiased`}
        suppressHydrationWarning
      >
        {children}
        <Toaster
          theme="dark"
          richColors
          position="top-right"
          toastOptions={{
            style: {
              background: "oklch(0.18 0.005 240)",
              border: "1px solid oklch(0.28 0.01 240)",
              color: "oklch(0.92 0 0)",
              fontFamily: "var(--font-display)",
            },
          }}
        />
      </body>
    </html>
  );
}
