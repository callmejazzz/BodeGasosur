import { ClerkProvider } from "@clerk/nextjs";
import { esMX } from "@clerk/localizations";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "BodeGasosur — Control de inventario",
  description:
    "Control de entradas, salidas y traspasos de material entre las bodegas y estaciones del grupo Gasosur.",
};

// Este layout no dibuja nada del sistema a propósito: solo la página y el
// proveedor de identidad. Quién ve la barra lateral lo decide (sistema)/layout,
// que antes verifica el acceso; las pantallas de (acceso) no la ven nunca.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full">
        {/* esMX: las pantallas de Clerk hablan el mismo idioma que el resto del sistema. */}
        {/* afterSignOutUrl: cerrar sesión tiene que llevar a algún lado. Sin esto,
            quien sale desde el UserButton de la barra se queda viendo una pantalla
            del sistema para la que ya no tiene sesión. */}
        <ClerkProvider localization={esMX} afterSignOutUrl="/sign-in">
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
