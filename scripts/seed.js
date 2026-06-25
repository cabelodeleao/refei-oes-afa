/* eslint-disable no-console */
// Seed do banco: lê cadets-data.json, hasheia a senha inicial ("123456")
// e insere os cadetes + a conta admin no Supabase.
//
// Uso: npm run seed

require("dotenv").config({ path: ".env.local" });

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { createClient } = require("@supabase/supabase-js");

// Token secreto e aleatório (base64url) usado no QR code de cada cadete.
function newQrToken() {
  return crypto.randomBytes(18).toString("base64url");
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_PASSWORD = "123456";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "\n[seed] Variáveis de ambiente ausentes. Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local\n"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  const dataPath = path.join(__dirname, "..", "cadets-data.json");
  const cadets = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

  console.log(`[seed] ${cadets.length} cadetes lidos de cadets-data.json`);
  console.log(`[seed] Gerando hash da senha inicial ("${DEFAULT_PASSWORD}")...`);

  const passwordHash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);

  // Conta admin + cadetes. Todos com a mesma senha inicial.
  const rows = [
    {
      number: "admin",
      name: "Administrador",
      squadron: 0,
      is_admin: true,
      password_hash: passwordHash,
      must_change_password: false, // admin não é forçado a trocar a senha
    },
    ...cadets.map((c) => ({
      number: c.number,
      name: c.name,
      squadron: c.squadron,
      is_admin: false,
      password_hash: passwordHash,
      qr_token: newQrToken(),
      must_change_password: true, // cadetes trocam a senha padrão no 1º acesso
    })),
  ];

  console.log(`[seed] Inserindo ${rows.length} registros (upsert por number)...`);

  // Upsert em lotes para não estourar limites de payload.
  const BATCH = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from("cadets")
      .upsert(batch, { onConflict: "number", ignoreDuplicates: false });

    if (error) {
      console.error("[seed] Erro ao inserir lote:", error.message);
      process.exit(1);
    }
    inserted += batch.length;
    console.log(`[seed]   ${inserted}/${rows.length}`);
  }

  console.log("\n[seed] Concluído com sucesso ✔");
  console.log("[seed] Admin: number=admin senha=123456");
  console.log("[seed] Cadetes: senha inicial 123456\n");
}

main().catch((err) => {
  console.error("[seed] Falha inesperada:", err);
  process.exit(1);
});
