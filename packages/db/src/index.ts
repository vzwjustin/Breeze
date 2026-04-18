/**
 * Central Prisma client. Every package imports from here to avoid
 * instantiating multiple clients in dev (hot reload).
 */

// In production, this file exports a real PrismaClient singleton:
//
//   import { PrismaClient } from "@prisma/client";
//   declare global { var __breezePrisma: PrismaClient | undefined; }
//   export const prisma =
//     globalThis.__breezePrisma ?? new PrismaClient({ log: ["error", "warn"] });
//   if (process.env.NODE_ENV !== "production") globalThis.__breezePrisma = prisma;
//
// Kept as a stub here so the repo typechecks before `prisma generate`
// runs. Replace when the prisma client has been generated.
export const prisma = {
  // Intentionally empty placeholder. Use `pnpm db:generate` then replace.
} as unknown as import("./prisma-client-stub.js").PrismaClientLike;

export type { PrismaClientLike } from "./prisma-client-stub.js";
export * from "./crypto.js";
