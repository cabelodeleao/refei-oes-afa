import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import TrocarSenhaClient from "./TrocarSenhaClient";

export const dynamic = "force-dynamic";

export default async function TrocarSenhaPage() {
  const session = await getSession();
  if (!session) redirect("/");

  // Destino após a troca, conforme o papel do usuário.
  const home = session.is_admin
    ? "/admin"
    : session.is_fiscal
      ? "/fiscal"
      : "/cadete";

  // Admin ou quem já trocou não deve ficar nesta tela.
  if (session.is_admin || !session.must_change_password) redirect(home);

  return <TrocarSenhaClient name={session.name} home={home} />;
}
