import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const BUILDINGS: Record<string, string[]> = {
  'Bâtiment A': ['A101', 'A102', 'A201', 'A202'],
  'Bâtiment B': ['B101', 'B102', 'B201'],
};

const PROGRAMS = ['Bachelor Informatique', 'Bachelor Management', 'Master Finance', 'MBA'];

const DEFAULT_PASSWORD = 'Passw0rd!';

async function seedBuildings() {
  for (const [name, roomNumbers] of Object.entries(BUILDINGS)) {
    const building = await prisma.building.upsert({ where: { name }, update: {}, create: { name } });

    for (const number of roomNumbers) {
      await prisma.room.upsert({
        where: { buildingId_number: { buildingId: building.id, number } },
        update: {},
        create: { number, buildingId: building.id },
      });
    }
  }
}

async function seedPrograms() {
  for (const name of PROGRAMS) {
    await prisma.program.upsert({ where: { name }, update: {}, create: { name } });
  }
}

async function seedUsers() {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const buildingA = await prisma.building.findUniqueOrThrow({ where: { name: 'Bâtiment A' } });

  const users = [
    { email: 'admin@bem.sn', fullName: 'Administrateur', role: Role.ADMIN },
    { email: 'mg@bem.sn', fullName: 'Service Moyens Généraux', role: Role.MOYENS_GENERAUX },
    { email: 'vigile.a@bem.sn', fullName: 'Vigile Bâtiment A', role: Role.VIGILE, buildingId: buildingA.id },
    { email: 'delegue@bem.sn', fullName: 'Délégué de classe', role: Role.DELEGUE },
  ];

  for (const user of users) {
    await prisma.user.upsert({ where: { email: user.email }, update: {}, create: { ...user, passwordHash } });
  }
}

async function main() {
  await seedBuildings();
  await seedPrograms();
  await seedUsers();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
