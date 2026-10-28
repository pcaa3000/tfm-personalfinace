// Public API of the categorization module.
// Owns the category catalog, natures and explainable suggestion rules.
export { PrismaCategoryValidationAdapter } from "./infrastructure/prisma-category-validation.adapter.js";
export {
  CATEGORY_CATALOG,
  type CategoryCatalogPort,
  type CategoryView,
} from "./application/category-catalog.port.js";
