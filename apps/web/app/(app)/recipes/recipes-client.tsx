"use client";

import { useState } from "react";
import type { Recipe } from "@breeze/common";
import { Badge, Button, Card, EmptyState, Input, PageHeader, SectionLabel, Textarea } from "@breeze/ui";

interface CatalogTrigger {
  key: string;
  connector: string;
  description: string;
}

interface Props {
  recipes: Recipe[];
  triggers: CatalogTrigger[];
}

export function RecipesClient({ recipes: initial, triggers }: Props) {
  const [recipes, setRecipes] = useState(initial);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerKey, setTriggerKey] = useState(triggers[0]?.key ?? "");
  const [capability, setCapability] = useState("files.move_file");
  const [templateKey, setTemplateKey] = useState("inbox/{{item.id}}.md");
  const [toKey, setToKey] = useState("journal/{{item.id}}.md");
  const [pollSeconds, setPollSeconds] = useState("300");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    const res = await fetch("/api/recipes");
    const data = (await res.json()) as { recipes: Recipe[] };
    setRecipes(data.recipes);
  };

  const createRecipe = async () => {
    setBusy("create");
    setError(null);
    try {
      const res = await fetch("/api/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || undefined,
          trigger: { key: triggerKey, input: {}, pollSeconds: Number(pollSeconds) },
          actions: [
            {
              capability,
              inputTemplate: { key: templateKey, toKey },
            },
          ],
          approvalMode: "policy",
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Failed (${res.status})`);
      }
      setShowForm(false);
      setName("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const runNow = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/recipes/${id}/run`, { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Run failed (${res.status})`);
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const toggleStatus = async (id: string, status: "active" | "paused") => {
    setBusy(`status-${id}`);
    await fetch(`/api/recipes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await refresh();
    setBusy(null);
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 24px" }}>
      <PageHeader
        title="Recipes"
        description="When something happens (trigger), Breeze runs your actions automatically."
        action={
          <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "New recipe"}
          </Button>
        }
      />

      {error && (
        <p style={{ color: "var(--color-error)", fontSize: 14, marginBottom: 16 }}>{error}</p>
      )}

      {showForm && (
        <Card style={{ marginBottom: 32 }}>
          <SectionLabel>New recipe</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Textarea placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            <label style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
              Trigger
              <select
                value={triggerKey}
                onChange={(e) => setTriggerKey(e.target.value)}
                style={{ display: "block", width: "100%", marginTop: 4, padding: 8, borderRadius: 8, border: "1px solid var(--color-border)" }}
              >
                {triggers.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.key} — {t.description}
                  </option>
                ))}
              </select>
            </label>
            <Input placeholder="Poll interval (seconds)" value={pollSeconds} onChange={(e) => setPollSeconds(e.target.value)} />
            <Input placeholder="Action capability" value={capability} onChange={(e) => setCapability(e.target.value)} />
            <Input placeholder="Template: source key" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} />
            <Input placeholder="Template: destination key" value={toKey} onChange={(e) => setToKey(e.target.value)} />
            <Button variant="primary" disabled={!name.trim() || busy === "create"} onClick={createRecipe}>
              {busy === "create" ? "Creating…" : "Create recipe"}
            </Button>
          </div>
        </Card>
      )}

      {recipes.length === 0 ? (
        <EmptyState
          title="No recipes yet"
          description="Create a recipe to automate triggers like new GitHub notifications or files."
          action={<Button onClick={() => setShowForm(true)}>Create your first recipe</Button>}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {recipes.map((r) => (
            <Card key={r.id} padding={16}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{r.name}</span>
                    <Badge variant={r.status === "active" ? "success" : "default"}>{r.status}</Badge>
                  </div>
                  {r.description && (
                    <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 8 }}>{r.description}</p>
                  )}
                  <p style={{ fontSize: 12, color: "var(--color-text-faint)" }}>
                    {r.trigger.key} · every {r.trigger.pollSeconds}s · {r.actions.length} action(s)
                  </p>
                  {r.nextRunAt && (
                    <p style={{ fontSize: 12, color: "var(--color-text-faint)", marginTop: 4 }}>
                      Next run {new Date(r.nextRunAt).toLocaleString()}
                    </p>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                  <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => runNow(r.id)}>
                    {busy === r.id ? "Running…" : "Run now"}
                  </Button>
                  {r.status === "active" ? (
                    <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => toggleStatus(r.id, "paused")}>
                      Pause
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => toggleStatus(r.id, "active")}>
                      Resume
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
