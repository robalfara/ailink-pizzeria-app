import type { NextConfig } from "next";

// La app dejó de ser un export estático al añadir el área de cliente: la sesión
// vive en cookies httpOnly que solo se pueden emitir desde el servidor.
// `next build` ya no genera `out/`; el despliegue necesita un runtime Node.
const nextConfig: NextConfig = {};

export default nextConfig;
