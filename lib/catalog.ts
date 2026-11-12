// Server-side price list. Prices live here and in the booking record, never in the browser (playbook PP-01).
export type Experience = {
  id: string;
  title: string;
  blurb: string;
  location: string;
  duration: string;
  amount: string; // decimal string in USD, e.g. "120.00"
  currency: "USD"; // PayPal does not support KRW, so the demo uses USD
};

export const EXPERIENCES: Experience[] = [
  {
    id: "sunrise-kayak",
    title: "Sunrise Kayak Tour",
    blurb: "Paddle across a calm bay while the city wakes up. Gear, a guide and a warm drink are included.",
    location: "Harbor Pier 3",
    duration: "2 hours",
    amount: "120.00",
    currency: "USD",
  },
  {
    id: "pottery-wheel",
    title: "Pottery Wheel Class",
    blurb: "Throw your first bowl with a ceramic artist. Your piece is glazed and fired for you.",
    location: "Clay Room Studio",
    duration: "90 minutes",
    amount: "85.00",
    currency: "USD",
  },
  {
    id: "night-food-walk",
    title: "Night Market Food Walk",
    blurb: "Taste eight street dishes with a local guide who knows every stall owner by name.",
    location: "Old Town Gate",
    duration: "3 hours",
    amount: "64.00",
    currency: "USD",
  },
];

export function findExperience(id: string): Experience | null {
  return EXPERIENCES.find((e) => e.id === id) ?? null;
}

export function formatUsd(amount: string): string {
  return `$${Number(amount).toFixed(2)}`;
}
