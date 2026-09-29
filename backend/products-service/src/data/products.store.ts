export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  /** Id of the user in users-service who owns this listing. */
  ownerId: string;
}

/** In-memory products store — replace with a real database in production. */
export const products: Product[] = [
  { id: '1', name: 'Widget A', category: 'widgets', price: 9.99, stock: 100, ownerId: '1' },
  { id: '2', name: 'Widget B', category: 'widgets', price: 19.99, stock: 50, ownerId: '2' },
  { id: '3', name: 'Gadget X', category: 'gadgets', price: 49.99, stock: 25, ownerId: '1' },
];

let lastId = Math.max(0, ...products.map((product) => Number(product.id)));

/**
 * The next product id: sequential, and never reused. `products.length + 1` would collide with a
 * live id after any delete (remove 1 of [1, 2, 3], and the next create is a second 3).
 */
export function nextProductId(): string {
  lastId += 1;
  return String(lastId);
}
