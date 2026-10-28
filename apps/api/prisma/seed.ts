import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const GLOBAL_CATEGORIES = [
  { key: "salary", label: "Salary", nature: "income" },
  { key: "other_income", label: "Other income", nature: "income" },
  { key: "home", label: "Home", nature: "essential" },
  { key: "food", label: "Food", nature: "essential" },
  { key: "transport", label: "Transport", nature: "essential" },
  { key: "health", label: "Health", nature: "essential" },
  { key: "services", label: "Services & subscriptions", nature: "essential" },
  { key: "education", label: "Education", nature: "essential" },
  { key: "leisure", label: "Leisure", nature: "discretionary" },
  { key: "restaurants", label: "Restaurants & cafes", nature: "discretionary" },
  { key: "shopping", label: "Shopping", nature: "discretionary" },
  { key: "taxes", label: "Taxes & obligations", nature: "obligation" },
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
