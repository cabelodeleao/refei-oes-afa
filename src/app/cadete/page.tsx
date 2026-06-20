import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import CadeteClient from "./CadeteClient";

export const dynamic = "force-dynamic";

export default async function CadetePage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.is_admin) redirect("/admin");

  return (
    <CadeteClient
      user={{
        name: session.name,
        number: session.number,
        squadron: session.squadron,
      }}
    />
  );
}
