import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import postgres from "postgres";

// Booking storage. Local runs use a JSON file; serverless deployments need DATABASE_URL (any Postgres).

export type BookingStatus = "awaiting_payment" | "payment_pending" | "paid";

export type Booking = {
  id: string;
  experienceId: string;
  title: string;
  date: string;
  guestName: string;
  email: string;
  amount: string;
  currency: "USD";
  status: BookingStatus;
  paypalOrderId: string | null;
  captureId: string | null;
  createdAt: string;
  paidAt: string | null;
};

export type Store = {
  kind: "file" | "postgres";
  insert(b: Booking): Promise<void>;
  get(id: string): Promise<Booking | null>;
  update(id: string, patch: Partial<Booking>): Promise<Booking | null>;
};

export function newBookingId(): string {
  return "bk_" + crypto.randomBytes(6).toString("hex");
}

function fileStore(): Store {
  const file = path.join(process.cwd(), ".data", "bookings.json");
  let chain: Promise<unknown> = Promise.resolve();

  const read = async (): Promise<Record<string, Booking>> => {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      return {};
    }
  };
  const write = async (all: Record<string, Booking>) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(all, null, 2));
    await fs.rename(tmp, file);
  };
  // One writer at a time inside this process.
  const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  return {
    kind: "file",
    insert: (b) =>
      serial(async () => {
        const all = await read();
        all[b.id] = b;
        await write(all);
      }),
    get: async (id) => (await read())[id] ?? null,
    update: (id, patch) =>
      serial(async () => {
        const all = await read();
        const cur = all[id];
        if (!cur) return null;
        const next = { ...cur, ...patch, id: cur.id };
        all[id] = next;
        await write(all);
        return next;
      }),
  };
}

function pgStore(url: string): Store {
  const sql = postgres(url, {
    prepare: false, // works with transaction poolers (Supabase, Neon)
    max: 3,
    ssl: process.env.DATABASE_SSL === "disable" ? false : "require",
  });
  let ready: Promise<unknown> | null = null;
  const init = () =>
    (ready ??= sql`create table if not exists bookings (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )`);
  const asJson = (v: unknown) => sql.json(v as postgres.JSONValue);

  return {
    kind: "postgres",
    async insert(b) {
      await init();
      await sql`insert into bookings (id, data) values (${b.id}, ${asJson(b)})`;
    },
    async get(id) {
      await init();
      const rows = await sql`select data from bookings where id = ${id}`;
      return (rows[0]?.data as Booking | undefined) ?? null;
    },
    async update(id, patch) {
      await init();
      const rows = await sql`update bookings set data = data || ${asJson(patch)}, updated_at = now()
        where id = ${id} returning data`;
      return (rows[0]?.data as Booking | undefined) ?? null;
    },
  };
}

let store: Store | null = null;

export function getStore(): Store {
  if (store) return store;
  const url = process.env.DATABASE_URL;
  if (url) {
    store = pgStore(url);
  } else {
    if (process.env.VERCEL) {
      throw new Error("DATABASE_URL is required on Vercel: a file store does not persist on serverless hosts.");
    }
    store = fileStore();
  }
  return store;
}
