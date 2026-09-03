import {
  pgTable,
  bigint,
  text,
  doublePrecision,
  integer,
  boolean,
  serial,
  primaryKey,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

// ---------- users ----------
export const users = pgTable("users", {
  userId: bigint("user_id", { mode: "number" }).primaryKey(),
  username: text("username"),
  firstName: text("first_name"),
  balanceRub: doublePrecision("balance_rub").notNull().default(0),
  freeRequests: integer("free_requests").notNull().default(0),
  refBy: bigint("ref_by", { mode: "number" }),
  banned: boolean("banned").notNull().default(false),
  chatMode: text("chat_mode").notNull().default("normal"), // normal | economy
  activeModel: text("active_model"), // модель, выбранная для чата в мини-аппе
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// ---------- wallets: токены по каждой модели ----------
export const wallets = pgTable(
  "wallets",
  {
    userId: bigint("user_id", { mode: "number" }).notNull(),
    modelKey: text("model_key").notNull(),
    remaining: doublePrecision("remaining").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.modelKey] })],
);

// ---------- transactions (пополнения через Platega) ----------
export const transactions = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(), // UUID, он же id в Platega
    userId: bigint("user_id", { mode: "number" }).notNull(),
    amountRub: doublePrecision("amount_rub").notNull(),
    status: text("status").notNull(), // pending | paid | failed
    method: integer("method"),
    credited: boolean("credited").notNull().default(false),
    paymentUrl: text("payment_url"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    paidAt: bigint("paid_at", { mode: "number" }),
  },
  (t) => [index("transactions_user_idx").on(t.userId), index("transactions_status_idx").on(t.status)],
);

// ---------- purchases (покупки пакетов токенов) ----------
export const purchases = pgTable(
  "purchases",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number" }).notNull(),
    modelKey: text("model_key").notNull(),
    tokens: integer("tokens").notNull(),
    priceRub: doublePrecision("price_rub").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("purchases_user_idx").on(t.userId)],
);

// ---------- dialogs (история чата с моделью) ----------
export const dialogs = pgTable(
  "dialogs",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number" }).notNull(),
    modelKey: text("model_key").notNull(),
    role: text("role").notNull(), // user | assistant
    content: text("content").notNull(),
    attachments: jsonb("attachments"), // [{kind, mime_type, filename, data_b64|text}]
    imageB64: text("image_b64"), // сгенерированная картинка (для image-моделей)
    tokens: integer("tokens"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("dialogs_user_model_idx").on(t.userId, t.modelKey)],
);

// ---------- tickets ----------
export const tickets = pgTable("tickets", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  status: text("status").notNull().default("open"), // open | closed
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const ticketMessages = pgTable(
  "ticket_messages",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id").notNull(),
    sender: text("sender").notNull(), // user | admin
    text: text("text").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("ticket_messages_ticket_idx").on(t.ticketId)],
);

// ---------- promo codes ----------
export const promoCodes = pgTable("promo_codes", {
  code: text("code").primaryKey(),
  bonusRub: doublePrecision("bonus_rub").notNull(),
  maxUses: integer("max_uses").notNull(),
  usedCount: integer("used_count").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const promoRedemptions = pgTable(
  "promo_redemptions",
  {
    code: text("code").notNull(),
    userId: bigint("user_id", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.code, t.userId] })],
);

// ---------- settings (ключ ForgetAPI и т.п.) ----------
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
});

// ---------- FSM-состояния бота (переживают перезапуск, в отличие от MemoryStorage) ----------
export const userStates = pgTable("user_states", {
  userId: bigint("user_id", { mode: "number" }).primaryKey(),
  state: text("state"), // null = главное меню
  data: jsonb("data"),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export type User = typeof users.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type TicketMessage = typeof ticketMessages.$inferSelect;
export type Dialog = typeof dialogs.$inferSelect;
