import { listConnectors } from "@breeze/connectors";

export default function ConnectorsPage() {
  const connectors = listConnectors();
  return (
    <section>
      <h1>Connectors</h1>
      <ul style={{ display: "grid", gap: 12 }}>
        {connectors.map((c) => (
          <li key={c.meta.key} style={{ border: "1px solid #eee", padding: 12, borderRadius: 8 }}>
            <strong>{c.meta.displayName}</strong>
            <div style={{ color: "#64748B" }}>{c.meta.description}</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              Capabilities: {c.capabilities.map((cap) => cap.key).join(", ")}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
