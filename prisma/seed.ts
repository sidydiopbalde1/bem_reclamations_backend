import { PrismaClient, ReclamationCategory, ReclamationStatus, Role, Priority } from '@prisma/client';
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
    { email: 'regulateur@bem.sn', fullName: 'Régulateur Principal', role: Role.REGULATEUR },
    { email: 'vigile.a@bem.sn', fullName: 'Vigile Bâtiment A', role: Role.VIGILE, buildingId: buildingA.id },
    { email: 'delegue@bem.sn', fullName: 'Délégué de classe', role: Role.DELEGUE },
  ];

  for (const user of users) {
    await prisma.user.upsert({ where: { email: user.email }, update: {}, create: { ...user, passwordHash } });
  }
}

async function seedReclamations() {
  const delegue = await prisma.user.findUniqueOrThrow({ where: { email: 'delegue@bem.sn' } });
  const vigile = await prisma.user.findUniqueOrThrow({ where: { email: 'vigile.a@bem.sn' } });
  const regulateur = await prisma.user.findUniqueOrThrow({ where: { email: 'regulateur@bem.sn' } });
  const mg = await prisma.user.findUniqueOrThrow({ where: { email: 'mg@bem.sn' } });

  const roomA101 = await prisma.room.findFirstOrThrow({ where: { number: 'A101' } });
  const roomA102 = await prisma.room.findFirstOrThrow({ where: { number: 'A102' } });
  const roomB101 = await prisma.room.findFirstOrThrow({ where: { number: 'B101' } });

  const progInfo = await prisma.program.findFirstOrThrow({ where: { name: 'Bachelor Informatique' } });
  const progMgmt = await prisma.program.findFirstOrThrow({ where: { name: 'Bachelor Management' } });

  // Skip if seed reclamations already exist (reported by seed delegue account)
  const existingFromSeedDelegue = await prisma.reclamation.count({
    where: { reportedBy: { email: 'delegue@bem.sn' } },
  });
  if (existingFromSeedDelegue > 0) return;

  const reclamations = [
    {
      category: ReclamationCategory.CLIMATISATION,
      priority: Priority.HAUTE,
      status: ReclamationStatus.OUVERTE,
      description: 'La climatisation en salle A101 ne fonctionne plus depuis 3 jours. Les étudiants souffrent de la chaleur.',
      roomId: roomA101.id,
      programId: progInfo.id,
      reportedById: delegue.id,
    },
    {
      category: ReclamationCategory.ECLAIRAGE,
      priority: Priority.NORMALE,
      status: ReclamationStatus.EN_COURS,
      description: 'Plusieurs ampoules sont grillées en salle A102. La salle est mal éclairée.',
      roomId: roomA102.id,
      programId: progMgmt.id,
      reportedById: delegue.id,
      assignedToId: regulateur.id,
    },
    {
      category: ReclamationCategory.PLOMBERIE,
      priority: Priority.URGENTE,
      status: ReclamationStatus.OUVERTE,
      description: 'Fuite d\'eau dans les sanitaires du Bâtiment A. Risque de dégâts importants.',
      roomId: roomA101.id,
      programId: progInfo.id,
      reportedById: vigile.id,
    },
    {
      category: ReclamationCategory.MOBILIER,
      priority: Priority.BASSE,
      status: ReclamationStatus.RESOLUE,
      description: 'Chaises cassées en salle B101. Environ 5 chaises nécessitent un remplacement.',
      roomId: roomB101.id,
      programId: progMgmt.id,
      reportedById: vigile.id,
      assignedToId: regulateur.id,
      resolvedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    },
    {
      category: ReclamationCategory.EQUIPEMENT,
      priority: Priority.HAUTE,
      status: ReclamationStatus.OUVERTE,
      description: 'Le projecteur de la salle A101 ne s\'allume plus. Les cours nécessitant des présentations sont impactés.',
      roomId: roomA101.id,
      programId: progInfo.id,
      reportedById: delegue.id,
    },
    {
      category: ReclamationCategory.PROPRETE,
      priority: Priority.NORMALE,
      status: ReclamationStatus.REJETEE,
      description: 'Nettoyage insuffisant de la salle B101 après les travaux.',
      roomId: roomB101.id,
      programId: progMgmt.id,
      reportedById: regulateur.id,
    },
    {
      category: ReclamationCategory.ELECTRICITE,
      priority: Priority.URGENTE,
      status: ReclamationStatus.OUVERTE,
      description: 'Court-circuit dans la salle A202. Plusieurs prises électriques ne fonctionnent plus.',
      roomId: roomA102.id,
      programId: progInfo.id,
      reportedById: vigile.id,
    },
    {
      category: ReclamationCategory.CLIMATISATION,
      priority: Priority.NORMALE,
      status: ReclamationStatus.EN_COURS,
      description: 'La climatisation de la salle A201 est en panne. Temperature trop élevée pour travailler.',
      roomId: roomA102.id,
      programId: progMgmt.id,
      reportedById: regulateur.id,
      assignedToId: regulateur.id,
    },
  ];

  for (const rec of reclamations) {
    const { status, assignedToId, resolvedAt, ...rest } = rec;
    await prisma.reclamation.create({
      data: {
        ...rest,
        ...(assignedToId ? { assignedToId } : {}),
        ...(resolvedAt ? { resolvedAt } : {}),
        status,
        events: {
          create: {
            toStatus: ReclamationStatus.OUVERTE,
            authorId: rest.reportedById,
          },
        },
      },
    });
  }

  console.log(`✅ ${reclamations.length} réclamations créées`);
}

async function main() {
  await seedBuildings();
  await seedPrograms();
  await seedUsers();
  await seedReclamations();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
