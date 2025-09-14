import { PrismaClient } from '@prisma/client';
import { genJoinCode } from '../src/utils/joinCode';
const prisma = new PrismaClient();

async function main() {
  const groups = await prisma.group.findMany({ where: { joinCode: null } });
  for (const g of groups) {
    let code: string | null = null;
    for (let i = 0; i < 10; i++) {
      const c = genJoinCode(6);
      const exists = await prisma.group.findUnique({ where: { joinCode: c } });
      if (!exists) { code = c; break; }
    }
    if (code) {
      await prisma.group.update({ where: { id: g.id }, data: { joinCode: code } });
      console.log(`Group ${g.id} -> ${code}`);
    }
  }
}
main().finally(() => prisma.$disconnect());
