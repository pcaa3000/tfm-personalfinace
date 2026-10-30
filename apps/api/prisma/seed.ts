import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Spanish-first product: labels match docs/06 (Hogar, Comida, Sueldo…).
// Keys stay stable English identifiers; the web translates them per locale.
const GLOBAL_CATEGORIES = [
  { key: "salary", label: "Sueldo", nature: "income" },
  { key: "other_income", label: "Otros ingresos", nature: "income" },
  { key: "home", label: "Hogar", nature: "essential" },
  { key: "food", label: "Comida", nature: "essential" },
  { key: "transport", label: "Transporte", nature: "essential" },
  { key: "health", label: "Salud", nature: "essential" },
  { key: "services", label: "Servicios y suscripciones", nature: "essential" },
  { key: "education", label: "Educación", nature: "essential" },
  { key: "leisure", label: "Ocio", nature: "discretionary" },
  { key: "restaurants", label: "Restaurantes y cafés", nature: "discretionary" },
  { key: "shopping", label: "Compras", nature: "discretionary" },
  { key: "taxes", label: "Impuestos y obligaciones", nature: "obligation" },
] as const;

async function main(): Promise<void> {
  await prisma.workspace.upsert({
    where: { identityKey: "local|dev-user" },
    update: {},
    create: {
      id: "ws-local-dev",
      identityKey: "local|dev-user",
      kind: "personal",
      locale: "en-US",
      timezone: "UTC",
      defaultCurrency: "USD",
    },
  });

  for (const category of GLOBAL_CATEGORIES) {
    const existing = await prisma.category.findFirst({
      where: { key: category.key, workspaceId: null },
    });
    if (existing) {
      await prisma.category.update({
        where: { id: existing.id },
        data: { label: category.label, nature: category.nature },
      });
    } else {
      await prisma.category.create({ data: { ...category, workspaceId: null } });
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
