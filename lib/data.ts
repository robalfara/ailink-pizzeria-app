export type MenuItem = {
  name: string;
  description: string;
  price: string;
  tags?: string[];
};

export type MenuCategory = {
  id: string;
  title: string;
  emoji: string;
  items: MenuItem[];
};

export const menu: MenuCategory[] = [
  {
    id: "clasicas",
    title: "Pizzas Clásicas",
    emoji: "🍕",
    items: [
      {
        name: "Margherita DOP",
        description:
          "San Marzano, mozzarella fior di latte, albahaca fresca y aceite de oliva virgen extra.",
        price: "9,50 €",
        tags: ["Veggie"],
      },
      {
        name: "Marinara",
        description:
          "Tomate San Marzano, ajo, orégano y aceite de oliva. Sin lácteos, pura tradición.",
        price: "8,00 €",
        tags: ["Vegana"],
      },
      {
        name: "Diavola",
        description:
          "Salami picante calabrés, mozzarella, tomate y un toque de guindilla.",
        price: "11,50 €",
        tags: ["Picante"],
      },
      {
        name: "Quattro Formaggi",
        description:
          "Mozzarella, gorgonzola DOP, pecorino romano y parmesano curado 24 meses.",
        price: "12,00 €",
        tags: ["Veggie"],
      },
    ],
  },
  {
    id: "especiales",
    title: "Especiales de la Casa",
    emoji: "⭐",
    items: [
      {
        name: "Tartufo Nero",
        description:
          "Crema de trufa negra, mozzarella de búfala, champiñones y rúcula fresca.",
        price: "15,50 €",
      },
      {
        name: "Prosciutto e Rucola",
        description:
          "Prosciutto di Parma 18 meses, rúcula, virutas de parmesano y tomate cherry.",
        price: "14,00 €",
      },
      {
        name: "Nduja & Miele",
        description:
          "Nduja calabresa, mozzarella, un hilo de miel de acacia y ralladura de limón.",
        price: "13,50 €",
        tags: ["Picante"],
      },
    ],
  },
  {
    id: "entrantes",
    title: "Entrantes & Dulces",
    emoji: "🥗",
    items: [
      {
        name: "Burrata Pugliese",
        description:
          "Burrata cremosa entera, tomate confitado, albahaca y pan de masa madre.",
        price: "9,00 €",
        tags: ["Veggie"],
      },
      {
        name: "Arancini di Riso",
        description:
          "Croquetas de risotto rellenas de ragú y mozzarella, fritas al momento (4 uds).",
        price: "7,50 €",
      },
      {
        name: "Tiramisù della Nonna",
        description:
          "Receta familiar con mascarpone, café espresso y cacao amargo.",
        price: "6,50 €",
        tags: ["Veggie"],
      },
    ],
  },
];

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
