// Public API of the categorization module.
// Owns the category catalog, natures and explainable suggestion rules.
export { DrizzleCategoryValidationAdapter } from "./infrastructure/drizzle-category-validation.adapter.js";
export { DrizzleCategoryRepository } from "./infrastructure/drizzle-category.repository.js";
export { CreateCategoryUseCase } from "./application/create-category.use-case.js";
export { ReviseCategoryUseCase } from "./application/revise-category.use-case.js";
export { ArchiveCategoryUseCase } from "./application/archive-category.use-case.js";
export {
  CATEGORY_CATALOG,
  toCategoryView,
  type CategoryCatalogPort,
  type CategoryView,
} from "./application/category-catalog.port.js";
export {
  CATEGORY_REPOSITORY,
  type CategoryRepositoryPort,
} from "./application/ports/category-repository.port.js";
export { Category } from "./domain/category.js";
export type { CategoryNature } from "./domain/category.js";
