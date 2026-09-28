/**
 * The per-category aggregate this service owns in the shared cache. Every entry is stored under
 * `products-sync-service_categoryStats_<id>` — this service is the only writer of that prefix, so
 * consumers can read the entries directly and never need a hop through this service to get them.
 */
export interface CategoryStats {
  categoryId: string;
  productCount: number;
  totalStock: number;
  /** Mean of the products' prices, rounded to cents. */
  averagePrice: number;
  /** ISO timestamp of the last recomputation. */
  computedAt: string;
}

/** products-service answers in the workspace envelope; only `data` is of interest here. */
export interface Envelope<T> {
  data: T;
  error: { code: string; message: string } | null;
}

/** The fields of a product the aggregate needs — a structural subset of products-service's Product. */
export interface ProductLike {
  price: number;
  stock: number;
}

/**
 * Computes a category's stats from the products fetched fresh out of products-service.
 *
 * Only freshly computed values are ever stored in the cache — an aggregate is passed the raw
 * products and built from scratch on every recomputation, so a cached entry can never be derived
 * from another cached entry. Returns `null` for a category with no products: that is what gets
 * negative-cached, the same sentinel a missing user produces.
 */
export function computeCategoryStats(categoryId: string, products: ProductLike[]): CategoryStats | null {
  if (products.length === 0) return null;

  const totalPrice = products.reduce((sum, product) => sum + product.price, 0);
  const averagePrice = Math.round((totalPrice / products.length) * 100) / 100;

  return {
    categoryId,
    productCount: products.length,
    totalStock: products.reduce((sum, product) => sum + product.stock, 0),
    averagePrice,
    computedAt: new Date().toISOString(),
  };
}