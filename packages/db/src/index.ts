/**
 * Central Prisma client. Every package imports from here to avoid
 * instantiating multiple clients in dev (hot reload).
 */
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __breezePrisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__breezePrisma ?? new PrismaClient({ log: ["error", "warn"] });

if (process.env.NODE_ENV !== "production") {
  globalThis.__breezePrisma = prisma;
}

export * from "./crypto.js";
export type { PrismaClient };
