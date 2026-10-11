import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { prisma } from "../lib/db";

async function main() {
  const tables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
  );
  console.log("Tables in database:", tables.map((t) => t.table_name));

  const groups = await prisma.group.findMany({ select: { id: true, title: true, chatId: true } });
  console.log("Groups:", groups);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
