// Example data sets, made up for Sift and generated the same way every time (seeded), so the page ships no data files.

export interface Sample {
  id: string;
  name: string;
  fileName: string;
  description: string;
  csv: () => string;
}

/** Mulberry32: a small seeded generator, so every visitor gets the same example rows. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isoDate(day: Date): string {
  return day.toISOString().slice(0, 10);
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

const SHOPS = [
  {name: "Harbour", traffic: 1.25},
  {name: "Old Town", traffic: 1},
  {name: "Station", traffic: 0.8},
] as const;

const PRODUCTS = [
  {name: "Espresso", category: "Coffee", price: 2.6, weight: 5},
  {name: "Flat white", category: "Coffee", price: 3.8, weight: 7},
  {name: "Cappuccino", category: "Coffee", price: 3.6, weight: 6},
  {name: "Oat latte", category: "Coffee", price: 4.2, weight: 5},
  {name: "Iced tea", category: "Cold drinks", price: 3.2, weight: 3},
  {name: "Lemonade", category: "Cold drinks", price: 3.4, weight: 2},
  {name: "Croissant", category: "Bakery", price: 2.9, weight: 5},
  {name: "Cinnamon bun", category: "Bakery", price: 3.5, weight: 4},
  {name: "Banana bread", category: "Bakery", price: 3.1, weight: 2},
  {name: "Sandwich", category: "Lunch", price: 6.9, weight: 3},
] as const;

const PAYMENTS = ["Card", "Card", "Card", "Phone", "Phone", "Cash"] as const;

function weightedProduct(random: () => number) {
  const total = PRODUCTS.reduce((sum, product) => sum + product.weight, 0);
  let roll = random() * total;
  for (const product of PRODUCTS) {
    roll -= product.weight;
    if (roll < 0) return product;
  }
  return PRODUCTS[PRODUCTS.length - 1];
}

/** A year of orders from three cafés: busier in summer and at weekends, cold drinks in the warm months. */
export function cafeSalesCsv(): string {
  const random = seeded(2025);
  const lines = ["order_id,date,time,shop,product,category,quantity,unit_price,total,payment"];
  let orderId = 10_000;
  for (let day = new Date(Date.UTC(2025, 0, 1)); day.getUTCFullYear() === 2025; day.setUTCDate(day.getUTCDate() + 1)) {
    const month = day.getUTCMonth();
    const weekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
    const season = 1 + 0.25 * Math.sin(((month - 3) / 12) * 2 * Math.PI);
    for (const shop of SHOPS) {
      const orders = Math.round(7 * shop.traffic * season * (weekend ? 1.35 : 1) * (0.75 + random() * 0.5));
      for (let i = 0; i < orders; i++) {
        let product = weightedProduct(random);
        if (product.category === "Cold drinks" && (month < 4 || month > 8) && random() < 0.7) product = PRODUCTS[1];
        const quantity = random() < 0.78 ? 1 : random() < 0.8 ? 2 : 3;
        const price = month >= 6 ? Math.round(product.price * 1.05 * 10) / 10 : product.price;
        const hour = 7 + Math.floor(random() * (product.category === "Lunch" ? 3 : 11)) + (product.category === "Lunch" ? 11 : 0);
        const minute = Math.floor(random() * 60);
        const time = `${String(Math.min(hour, 19)).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
        lines.push(
          [
            orderId++,
            isoDate(day),
            time,
            shop.name,
            product.name,
            product.category,
            quantity,
            price.toFixed(2),
            (price * quantity).toFixed(2),
            pick(random, PAYMENTS),
          ].join(","),
        );
      }
    }
  }
  return lines.join("\n") + "\n";
}

/** Daily readings from a made-up coastal weather station, with a few gaps where the sensor was down. */
export function weatherCsv(): string {
  const random = seeded(7);
  const lines = ["date,temp_min_c,temp_max_c,rain_mm,wind_kmh,sunshine_h,conditions"];
  for (let day = new Date(Date.UTC(2025, 0, 1)); day.getUTCFullYear() === 2025; day.setUTCDate(day.getUTCDate() + 1)) {
    const dayOfYear = Math.floor((day.getTime() - Date.UTC(2025, 0, 1)) / 86_400_000);
    const season = Math.sin(((dayOfYear - 105) / 365) * 2 * Math.PI);
    const mean = 11 + 8 * season + (random() - 0.5) * 6;
    const spread = 5 + random() * 4 + 2 * season;
    const wet = random() < 0.42 - 0.12 * season;
    const rain = wet ? Math.round(random() ** 2 * 28 * 10) / 10 : 0;
    const sunshine = Math.max(0, Math.round((7 + 5 * season - (wet ? 4 : 0) + (random() - 0.5) * 4) * 10) / 10);
    const wind = Math.round(12 + random() * 25 + (wet ? 8 : 0));
    const conditions = rain > 12 ? "Heavy rain" : rain > 0 ? "Showers" : sunshine > 9 ? "Sunny" : sunshine > 4 ? "Partly cloudy" : "Overcast";
    const gap = random() < 0.015;
    lines.push(
      [
        isoDate(day),
        gap ? "" : (mean - spread / 2).toFixed(1),
        gap ? "" : (mean + spread / 2).toFixed(1),
        gap ? "" : rain.toFixed(1),
        gap ? "" : wind,
        gap ? "" : sunshine.toFixed(1),
        gap ? "" : conditions,
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export const SAMPLES: readonly Sample[] = [
  {
    id: "cafe",
    name: "Café sales",
    fileName: "cafe-sales-2025.csv",
    description: "A year of orders from three cafés",
    csv: cafeSalesCsv,
  },
  {
    id: "weather",
    name: "Weather station",
    fileName: "weather-2025.csv",
    description: "Daily readings, with a few gaps",
    csv: weatherCsv,
  },
];
