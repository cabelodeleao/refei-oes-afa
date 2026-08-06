import { redirect } from "next/navigation";
import { getSession, homePath } from "@/lib/auth";
import RanchoClient from "./RanchoClient";

export const dynamic = "force-dynamic";

export default async function RanchoPage() {
  const session = await getSession();
  if (!session) redirect("/");
  // Só a conta do rancho (e o admin, que enxerga tudo) entram aqui.
  if (!session.is_rancho && !session.is_admin) redirect(homePath(session));

  return <RanchoClient user={{ name: session.name }} />;
}
