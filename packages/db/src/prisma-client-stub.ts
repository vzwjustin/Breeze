/**
 * A placeholder shape for PrismaClient so packages can typecheck before
 * `prisma generate` has been run. Replace imports of this with the real
 * `@prisma/client` once generation is wired into CI/bootstrap.
 */
export interface PrismaClientLike {
  $transaction: <T>(fn: (tx: PrismaClientLike) => Promise<T>) => Promise<T>;
  [model: string]: unknown;
}
