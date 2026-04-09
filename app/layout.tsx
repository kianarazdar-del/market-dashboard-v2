import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Market Dashboard",
  description: "Live market data — stocks, indices, crypto, real estate",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
