import { agenteConfigurado } from "@/lib/agente";

import Chat from "./components/Chat";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import Features from "./components/Features";
import Menu from "./components/Menu";
import Reviews from "./components/Reviews";
import Footer from "./components/Footer";

/**
 * A propósito NO hay `export const revalidate`.
 *
 * Ahora que `Menu` lee la carta de la base de datos, la tentación es cachear la
 * home unos minutos. No sirve, y además sería peligroso:
 *
 *  1. **No sirve**: esta ruta ya es dinámica —`NavbarSesion` lee cookies para
 *     saber quién eres—, así que no hay HTML cacheado que revalidar. El build
 *     la marca `ƒ (Dynamic)`, no `○ (Static)`.
 *  2. **Sería peligroso**: `revalidate` es un valor por defecto para TODO el
 *     segmento, y los `fetch` de este render no son solo el de la carta: son
 *     también los de Supabase que validan la sesión y leen el perfil. Ni
 *     `@supabase/ssr` ni `postgrest-js` marcan sus peticiones como no
 *     cacheables, así que un `revalidate` de segmento las mete a todas en el
 *     mismo saco. Cachear la validación de sesión es servirle a un visitante la
 *     sesión de otro.
 *
 * Si algún día la query de la carta pesa, el sitio de la caché es
 * `obtenerCarta()` y solo ella (`unstable_cache`, o `"use cache"` con
 * `cacheComponents`), nunca un valor por defecto de segmento.
 */
export default function Home() {
  return (
    <>
      <Navbar />
      <main className="flex-1">
        <Hero />
        <Features />
        <Menu />
        <Reviews />
      </main>
      <Footer />

      {/* Sin N8N_AGENTE_URL el chat no se pinta: la landing sigue en pie sin
          n8n delante, igual que pasa con los avisos de lib/n8n.ts. */}
      {agenteConfigurado() && <Chat />}
    </>
  );
}
