import type { Metadata } from "next";
import { Playfair_Display, Poppins } from "next/font/google";
import "./globals.css";

const playfair = Playfair_Display({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const poppins = Poppins({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Forno Nostro · Auténtica pizza napolitana",
  description:
    "Pizzería artesanal con masa de fermentación lenta, horno de leña y los mejores ingredientes italianos. Descubre nuestra carta.",
  openGraph: {
    title: "Forno Nostro · Auténtica pizza napolitana",
    description:
      "Masa de fermentación lenta de 48 horas, horno de leña a 450 °C e ingredientes DOP importados de Italia.",
    type: "website",
    locale: "es_ES",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${playfair.variable} ${poppins.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-cream text-charcoal font-body">
        {children}
      </body>
    </html>
  );
}
