import type { NextConfig } from "next";

// La app dejó de ser un export estático al añadir el área de cliente: la sesión
// vive en cookies httpOnly que solo se pueden emitir desde el servidor.
// `next build` ya no genera `out/`; el despliegue necesita un runtime Node.
const nextConfig: NextConfig = {
  // Solo afecta a `next dev`. Next bloquea por defecto las peticiones cross-origin
  // a recursos internos (/_next/webpack-hmr entre ellos), y el servidor se
  // inicializa con `localhost`: al abrir la app por la IP de la LAN, el socket de
  // hot reload se cae. Se declara ese origen como permitido.
  // Ver node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/allowedDevOrigins.md
  allowedDevOrigins: ["192.168.1.12"],
};

export default nextConfig;
