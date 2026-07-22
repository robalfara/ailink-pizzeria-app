import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sitio 100% estático: `next build` genera HTML/CSS/JS en la carpeta `out`.
  // Ver node_modules/next/dist/docs/01-app/02-guides/static-exports.md
  output: "export",

  // Sin servidor de optimización de imágenes en el export estático.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
