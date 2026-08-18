import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Navegacion } from "@/components/navegacion";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "BodeGasosur — Control de inventario",
  description:
    "Control de entradas, salidas y traspasos de material entre las bodegas y estaciones del grupo Gasosur.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full">
        <Navegacion />
        <main className="min-w-0 flex-1 px-8 py-7">{children}</main>
      </body>
    </html>
  );
}
