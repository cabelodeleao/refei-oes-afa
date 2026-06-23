import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import FiscalClient from "./FiscalClient";

export const dynamic = "force-dynamic";

export default async function FiscalPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (!(session.is_fiscal || session.is_admin)) redirect("/cadete");

  return <FiscalClient user={{ name: session.name }} />;
}
