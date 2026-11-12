import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

const localEnvPath = resolve(process.cwd(), ".env.local");
if (!process.env.DATABASE_URL && existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath, quiet: true });
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing. Add it to .env.local or the current shell environment.");
  process.exit(1);
}

const prismaCli = resolve(process.cwd(), "node_modules/prisma/build/index.js");
const requestedArgs = process.argv.slice(2);
let prismaArgs = requestedArgs.length > 0 ? requestedArgs : ["migrate", "deploy"];

// Read-only drift check for the existing database before adopting the baseline.
// The connection URL is passed directly to Prisma and is never printed.
if (prismaArgs[0] === "compare-schema") {
  const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DIRECT_URL or DATABASE_URL is required for the schema comparison.");
    process.exit(1);
  }
  prismaArgs = [
    "migrate",
    "diff",
    "--from-url",
    databaseUrl,
    "--to-schema-datamodel",
    resolve(process.cwd(), "prisma/schema.prisma"),
    "--script",
  ];
}

const result = spawnSync(process.execPath, [prismaCli, ...prismaArgs], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error("Could not start Prisma migration deployment.");
  process.exit(1);
}

process.exit(result.status ?? 1);
