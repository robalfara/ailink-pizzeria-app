import type { NextConfig } from "next";

// La app dejó de ser un export estático al añadir el área de cliente: la sesión
// vive en cookies httpOnly que solo se pueden emitir desde el servidor.
// `next build` ya no genera `out/`; el despliegue necesita un runtime Node.

const enProduccion = process.env.NODE_ENV === "production";

/**
 * Content Security Policy.
 *
 * No la había, y con ella no la había ninguna de las cabeceras de seguridad:
 * la app contestaba a pelo y encima anunciando `X-Powered-By: Next.js`.
 *
 * Es una CSP **estática**, sin nonce, y conviene saber por qué: el nonce hay
 * que generarlo por petición desde `proxy.ts`, y eso obliga a render dinámico
 * en todas las rutas. Con una CSP estática el precio es `'unsafe-inline'` en
 * `script-src`, porque el App Router inyecta en el HTML los scripts inline que
 * transportan los datos del servidor (`self.__next_f.push(...)`) y sin nonce no
 * hay forma de distinguirlos de uno inyectado. Sigue valiendo la pena: el resto
 * de directivas (`object-src`, `base-uri`, `form-action`, `frame-ancestors`)
 * cierran vectores que hoy están abiertos de par en par.
 *
 * Los orígenes se comprobaron uno a uno antes de escribirla:
 *
 *  - **Fuentes**: `app/layout.tsx` las carga con `next/font/google`, que las
 *    descarga en tiempo de build y las sirve desde `/_next/static/media`. No
 *    hay ninguna petición a fonts.googleapis.com ni a fonts.gstatic.com en
 *    tiempo de ejecución, así que `font-src 'self'` basta y no hay que abrir
 *    dominios de Google.
 *  - **Supabase**: no hay ningún `createBrowserClient` en el proyecto. Todo
 *    pasa por `lib/supabase/server.ts` y por `proxy.ts`, es decir, servidor
 *    contra servidor. El navegador nunca llama a `NEXT_PUBLIC_SUPABASE_URL`,
 *    así que `connect-src 'self'` es suficiente. ⚠️ El día que se añada un
 *    cliente de navegador de Supabase (realtime, storage desde el cliente…)
 *    hay que añadir aquí su origen o las peticiones se bloquearán en silencio.
 *  - **Chat**: `app/components/Chat.tsx` habla con `/api/chat`, mismo origen.
 */
const csp = [
  "default-src 'self'",
  // 'unsafe-eval' solo en desarrollo: React lo usa para reconstruir stacks del
  // servidor y Turbopack para el hot reload. En producción no hace falta.
  `script-src 'self' 'unsafe-inline'${enProduccion ? "" : " 'unsafe-eval'"}`,
  // Tailwind se compila a un fichero, pero React y el overlay de desarrollo
  // siguen emitiendo estilos inline.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // En desarrollo, el socket del hot reload.
  `connect-src 'self'${enProduccion ? "" : " ws:"}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Nadie tiene por qué meter esta web en un iframe. Es el antídoto del
  // clickjacking sobre el botón de "Salir" y sobre el formulario de /cuenta.
  "frame-ancestors 'none'",
  ...(enProduccion ? ["upgrade-insecure-requests"] : []),
].join("; ");

const cabecerasSeguridad = [
  { key: "Content-Security-Policy", value: csp },
  // Dos años. Sin `preload`: entrar en la lista de precarga de los navegadores
  // es un compromiso difícil de deshacer y afecta a todo el dominio, no solo a
  // esta app. Los navegadores ignoran esta cabecera cuando llega por HTTP, así
  // que en local no molesta.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  // Sin esto, un fichero subido como texto que el navegador decida interpretar
  // como HTML se ejecuta en nuestro origen.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // La ruta completa puede llevar tokens en la query (los enlaces de
  // confirmación de Supabase, sin ir más lejos). Fuera del sitio, solo origen.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Redundante con `frame-ancestors`, y a propósito: los navegadores viejos no
  // entienden la directiva de CSP pero sí esta cabecera.
  { key: "X-Frame-Options", value: "DENY" },
  // La landing no pide cámara, micrófono, ubicación ni pagos. Declararlo evita
  // que un script de terceros que entre mañana pueda pedirlos por nosotros.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];

const nextConfig: NextConfig = {
  // Solo afecta a `next dev`. Next bloquea por defecto las peticiones cross-origin
  // a recursos internos (/_next/webpack-hmr entre ellos), y el servidor se
  // inicializa con `localhost`: al abrir la app por la IP de la LAN, el socket de
  // hot reload se cae. Se declara ese origen como permitido.
  // Ver node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/allowedDevOrigins.md
  allowedDevOrigins: ["192.168.1.12"],

  // `X-Powered-By: Next.js` no aporta nada a quien visita la web y sí a quien
  // busca instalaciones con una versión concreta que explotar.
  poweredByHeader: false,

  // Ver node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md
  async headers() {
    return [
      {
        // `/:path*` incluye la raíz y todo lo que cuelga de ella, rutas de API
        // incluidas.
        source: "/:path*",
        headers: cabecerasSeguridad,
      },
      {
        // El área de cliente lleva datos personales en el HTML. Sin esto, un
        // proxy compartido o el disco del navegador pueden guardar la página y
        // enseñársela al siguiente que se siente delante.
        //
        // El modificador `*` es "cero o más segmentos", así que esto cubre
        // también `/cuenta` a secas.
        source: "/cuenta/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default nextConfig;
