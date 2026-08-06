import { redirect } from "next/navigation";
import { getSession, homePath } from "@/lib/auth";
import TrocarSenhaClient from "./TrocarSenhaClient";

export const dynamic = "force-dynamic";

export default async function TrocarSenhaPage() {
  const session = await getSession();
  if (!session) redirect("/");

  // Destino após a troca, conforme o papel do usuário.
  const home = homePath(session);

  // Admin ou quem já trocou não deve ficar nesta tela.
  if (session.is_admin || !session.must_change_password) redirect(home);

  return <TrocarSenhaClient name={session.name} home={home} />;
}
