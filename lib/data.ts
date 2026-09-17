/**
 * Contenido estático de la landing.
 *
 * Aquí vivía también la carta (`menu`, `MenuItem`, `MenuCategory`), y era la
 * segunda fuente de verdad de un dato que ya estaba en la base de datos
 * (`supabase/migrations/0002_carta.sql`). Se ha ido entera: la pinta
 * `app/components/Menu.tsx` leyendo de `obtenerCarta()`, así que subir un
 * precio vuelve a ser un solo sitio y un plato agotado desaparece a la vez de
 * la landing y de lo que cuenta el agente.
 *
 * Lo que queda son textos de marketing sin equivalente en la base de datos:
 * nadie los edita desde fuera del repo y el agente no los necesita.
 */

export type Review = {
  name: string;
  role: string;
  quote: string;
  rating: number;
  initials: string;
};

export const reviews: Review[] = [
  {
    name: "Lucía Fernández",
    role: "Vecina del barrio",
    quote:
      "La mejor Margherita que he probado fuera de Nápoles. La masa es ligera, aireada y con ese sabor a horno de leña inconfundible.",
    rating: 5,
    initials: "LF",
  },
  {
    name: "Marco Benedetti",
    role: "Crítico gastronómico",
    quote:
      "Ingredientes de primerísima calidad y una fermentación cuidada al detalle. Un rincón de la Italia auténtica en plena ciudad.",
    rating: 5,
    initials: "MB",
  },
  {
    name: "Sara Ortega",
    role: "Clienta habitual",
    quote:
      "Vengo cada semana. El trato es cercano, la pizza sale volando del horno y la burrata es de otro mundo. ¡Imprescindible!",
    rating: 5,
    initials: "SO",
  },
];

export type Feature = {
  emoji: string;
  title: string;
  description: string;
};

export const features: Feature[] = [
  {
    emoji: "🔥",
    title: "Horno de leña a 450 °C",
    description:
      "Cada pizza se cuece en 90 segundos, logrando un cornicione hinchado y ese punto ahumado tan característico.",
  },
  {
    emoji: "⏳",
    title: "Masa de 48 horas",
    description:
      "Fermentación lenta con masa madre para una digestión ligera y un sabor profundo imposible de imitar.",
  },
  {
    emoji: "🇮🇹",
    title: "Ingredientes DOP",
    description:
      "Tomate San Marzano, mozzarella di bufala y aceite virgen extra importados directamente de Italia.",
  },
  {
    emoji: "🛵",
    title: "Entrega en 30 min",
    description:
      "Llevamos la pizzería a tu mesa con un reparto propio que garantiza que llegue caliente y perfecta.",
  },
];
