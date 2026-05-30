import { requireUser } from "@/server/auth/require-user";
import { RecipeService } from "@/server/services/recipe-service";
import { prisma } from "@breeze/db";
import { publicTriggerCatalog } from "@breeze/connectors";
import { RecipesClient } from "./recipes-client";

const db = prisma as any;

export default async function RecipesPage() {
  const { user } = await requireUser();
  const recipes = await RecipeService.list(user.id);

  const accounts = await db.connectorAccount.findMany({
    where: { userId: user.id, status: "ACTIVE", deletedAt: null },
    select: { connectorKey: true },
  });
  const connected = new Set<string>(accounts.map((a: { connectorKey: string }) => a.connectorKey));
  const triggers = publicTriggerCatalog(connected).map((t) => ({
    key: t.key,
    connector: t.connector,
    description: t.description,
  }));

  return <RecipesClient recipes={recipes} triggers={triggers} />;
}
