import Link from "next/link";

export default function SettingsPage() {
  return (
    <section>
      <h1>Settings</h1>
      <ul>
        <li><Link href="/settings/models">Model &amp; provider</Link></li>
        <li><Link href="/settings/privacy">Privacy</Link></li>
        <li><Link href="/settings/policies">Policy profile</Link></li>
      </ul>
    </section>
  );
}
