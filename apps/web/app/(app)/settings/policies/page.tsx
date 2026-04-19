import { requireUser } from "@/server/auth/require-user";
import { prisma } from "@breeze/db";
import { BUILTIN_PROFILES } from "@breeze/policy/profiles";
import { PolicyProfileSelector } from "./policy-selector";

const db = prisma as any;

export default async function PoliciesPage() {
  const { user } = await requireUser();

  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    select: { policyProfileId: true },
  });

  const currentProfileId = dbUser?.policyProfileId ?? "builtin.auto_run_safe_actions";

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--color-text)", marginBottom: 4, letterSpacing: "-0.02em" }}>
        Policy Profile
      </h1>
      <p style={{ color: "var(--color-text-muted)", fontSize: 14, marginBottom: 32 }}>
        Control how much autonomy Breeze has. More restrictive profiles require your approval for more actions.
      </p>

      <PolicyProfileSelector
        profiles={BUILTIN_PROFILES}
        currentProfileId={currentProfileId}
      />
    </div>
  );
}
