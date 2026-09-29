import { Injectable, NotFoundException } from '@nestjs/common';
import { CacheService, ReadThroughService, assertTtlSeconds, cacheKeyOrNull, requestKey } from '@tw/cache';
import { RequestScopedLoggerService } from '@tw/logger';
import { UsersConnector } from '../connectors/users.connector';
import { nextProductId, products } from '../data/products.store';

import type { PublicUser } from '../connectors/users.connector';
import type { Product } from '../data/products.store';
import type { CreateProductDto } from './dto/create-product.dto';
import type { ListProductsQuery } from './dto/list-products.query';
import type { UpdateProductDto } from './dto/update-product.dto';

type ProductWithOwner = Product & { owner: PublicUser | null };

const CONTEXT = 'ProductsService';

/** The composite the request cache holds: the whole catalog with owners resolved. */
const CATALOG_ROUTE = 'v1-products';
/**
 * The composite's TTL. This service's writes invalidate the composite's key, but no write here can
 * reach the *other* owner's contribution to it — the owner entries users-service resolved into
 * the cached answer. For that part the clock is the invalidation: short on purpose, so the catalog
 * view may show an owner up to this many seconds stale and self-heals.
 */
const REQUEST_CACHE_TTL_SECONDS = Number(process.env.REQUEST_CACHE_TTL ?? 10);
// Checked when the module loads — at boot — like every TTL CacheModule.forRoot() is given. A value
// only checked per call would boot fine and then fail every composite request.
assertTtlSeconds(REQUEST_CACHE_TTL_SECONDS, 'REQUEST_CACHE_TTL');

/**
 * The shape id a list is cached under. `all` for the unfiltered list, `category.<name>` for a
 * category: the prefix keeps the two apart by construction, so `?category=all` is its own shape
 * and can never land on the unfiltered list's key. Truthiness matches `filterFromStore` — an empty
 * `?category=` is the unfiltered list there, so it is the `all` shape here.
 */
const listShape = (category: string | undefined): string => (category ? `category.${category}` : 'all');

/**
 * The Products domain's data — and this service owns its cache entries. Two read shapes, each a
 * rung of the caching ladder the workspace documents (see Shared Cache in the docs):
 *
 * - **Entities** — `GET /v1/products/:id` reads through the `product` entry like users-service
 *   reads a `user`: invalidated by this service on every write, negative-cached when absent.
 * - **Bounded lists** — `GET /v1/products` (and `?category=`) caches the whole hydrated list as
 *   one value under `productList_all` / `productList_category.<name>`. Any write to any product
 *   kills **every** list shape: the membership-vs-content split that "smarter" list caching does
 *   is a set of invalidation branches that can be gotten wrong, and its savings — one store read
 *   avoided per write window — are not worth them. An empty list is a valid cached value (`[]`),
 *   not the negative sentinel: "no products in this category" is a fact worth keeping, unlike
 *   "this product does not exist", which a write can change.
 * - **The composite** — `?expandOwner=true` with no filters is cached whole under a `requestKey()`
 *   for `REQUEST_CACHE_TTL_SECONDS`. This service's writes invalidate it like any local shape —
 *   it can name the key — so a product change is never masked by the composite. What no write of
 *   ours can reach is the *other* owner's contribution to it (the owner entries users-service
 *   resolved into the cached answer), and that is what the TTL bounds.
 *
 * Every key is built from the value its loader filters on, exactly as the request gave it — a
 * category or id that is not already canonical (`Widgets`, ` 1`) cannot form a key and is served
 * from the store, uncached. `?search=` is never cached either, and that is a decision rather than
 * an omission: free text cannot form a key (see `requestKey()`), because a key space nobody can
 * enumerate is one nobody can invalidate. Search reads the store every time.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly logger: RequestScopedLoggerService,
    private readonly cache: CacheService,
    private readonly readThrough: ReadThroughService,
    private readonly usersConnector: UsersConnector,
  ) {}

  async findAll(
    { search, category, expandOwner }: ListProductsQuery,
    noCache = false,
  ): Promise<(Product | ProductWithOwner)[]> {
    const result = await this.readAll(search, category, expandOwner, noCache);
    this.logger.info(`Returning ${result.length} product(s)`, `${CONTEXT}.findAll`);
    return result;
  }

  async findOne(id: string, expandOwner = false, noCache = false): Promise<Product | ProductWithOwner> {
    // The id comes from the URL: one that cannot form a key — including a non-canonical spelling
    // like `%201` — reads as null and falls back to the store, which answers for exactly that id.
    const key = cacheKeyOrNull('product', id);
    const load = async () => products.find((candidate) => candidate.id === id) ?? null;

    const product = await (key
      ? this.readThrough.readThrough<Product>({
          key,
          load,
          noCache,
          traceId: this.logger.traceId,
        })
      : load());

    if (!product) {
      this.logger.warn(`Product ${id} not found`, `${CONTEXT}.findOne`);
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    return expandOwner ? this.withOwner(product, noCache) : product;
  }

  create(dto: CreateProductDto): Product {
    const product: Product = { id: nextProductId(), ...dto };
    products.push(product);
    this.logger.info(`Created product ${product.id}`, `${CONTEXT}.create`);

    // The new item's key is invalidated too, on purpose: ids are sequential, so the next one is
    // predictable, and a read for it before it existed has cached "does not exist". A write that
    // skips its own item key leaves a 404 cached for a product that now exists.
    this.invalidateAfterWrite(product.id);
    return product;
  }

  update(id: string, changes: UpdateProductDto): Product {
    const index = products.findIndex((candidate) => candidate.id === id);

    if (index === -1) {
      this.logger.warn(`Cannot update product ${id}: not found`, `${CONTEXT}.update`);
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    const previous = products[index];
    // ES2022 class-field semantics make the DTO's *unset* optional members own properties with
    // value `undefined`, so a plain spread would write them over the stored values — clearing
    // every field the caller did not send. Drop the unset members before merging: an absent field
    // means "leave it", not "blank it".
    const applied = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
    products[index] = { ...products[index], ...applied };
    this.logger.info(`Updated product ${id}`, `${CONTEXT}.update`);

    // `previous.category` is passed explicitly: a category change can empty the old category out
    // of the store, and an emptied category still has a list entry to invalidate — one the
    // store can no longer name for us.
    this.invalidateAfterWrite(id, [previous.category]);
    return products[index];
  }

  remove(id: string): { deleted: true } {
    const index = products.findIndex((candidate) => candidate.id === id);

    if (index === -1) {
      this.logger.warn(`Cannot delete product ${id}: not found`, `${CONTEXT}.remove`);
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    const removed = products[index];
    products.splice(index, 1);
    this.logger.info(`Deleted product ${id}`, `${CONTEXT}.remove`);

    // Same reasoning as in update(): the deleted product's category may be the last of its kind,
    // and the store (scanned after the splice) can no longer name it.
    this.invalidateAfterWrite(id, [removed.category]);
    return { deleted: true };
  }

  /**
   * The read decision tree, one rung per shape:
   * search → the store, always; the composite → the request cache; everything else → the bounded
   * list cache, with owner hydration as a separate read per product.
   */
  private async readAll(
    search: string | undefined,
    category: string | undefined,
    expandOwner: boolean | undefined,
    noCache: boolean,
  ): Promise<(Product | ProductWithOwner)[]> {
    if (search) {
      this.logger.debug(
        `Search present ('${search}') — serving from the store; free-text shapes are never cached`,
        `${CONTEXT}.readAll`,
      );
      const found = this.filterFromStore(search, category);
      return expandOwner ? this.hydrateOwners(found, noCache) : found;
    }

    // The composite, and only this exact shape: the catalog view with owners, no filters. Deliberately
    // not a general response cache — each composite is opted in by naming its key here.
    if (expandOwner && !category) {
      return this.readThrough.readThrough<(Product | ProductWithOwner)[]>({
        key: requestKey('productCatalog', CATALOG_ROUTE, { expandOwner: true }),
        load: async () => {
          const list = this.filterFromStore(undefined, undefined);
          // The caller's no-cache reaches the parts too. Entity entries are invalidated on write,
          // but that is "fresh or TTL-bounded", not "always fresh" — a stale fill can outlive an
          // invalidation by up to its TTL — so a caller who asked for fresh data gets fresh owners,
          // not a new composite rebuilt from the entries it was trying to get past.
          return this.hydrateOwners(list, noCache);
        },
        ttlSeconds: REQUEST_CACHE_TTL_SECONDS,
        noCache,
        traceId: this.logger.traceId,
      });
    }

    // The category comes from the URL: one that cannot form a key (a space in it, or not already
    // canonical) reads as null and skips the cache entirely — the store still answers, with the
    // correct (possibly empty) list for exactly the category that was asked for.
    const listKey = cacheKeyOrNull('productList', listShape(category));
    if (!listKey) {
      this.logger.debug(
        `Category shape '${category}' cannot form a cache key — serving from the store`,
        `${CONTEXT}.readAll`,
      );
      const found = this.filterFromStore(undefined, category);
      return expandOwner ? this.hydrateOwners(found, noCache) : found;
    }

    const list = await this.readThrough.readThrough<Product[]>({
      // `[]` is a valid cached value: "no products in this category" is a fact, not an absence.
      key: listKey,
      load: async () => this.filterFromStore(undefined, category),
      noCache,
      traceId: this.logger.traceId,
    });

    return expandOwner ? this.hydrateOwners(list, noCache) : list;
  }

  private filterFromStore(search?: string, category?: string): Product[] {
    let result = products;
    if (search) {
      const needle = search.toLowerCase();
      result = result.filter((product) => product.name.toLowerCase().includes(needle));
    }
    if (category) result = result.filter((product) => product.category === category);
    return result;
  }

  /**
   * One outbound call per *product*, not per distinct owner — products sharing an owner each
   * fetch it again. That is a real N+1, left in deliberately: it is what the trace tooling
   * surfaces as a `repeatedEdges` entry, and it is the worked example in the tracing docs.
   * All the calls inherit the same trace id, so the fan-out shows as several
   * products-service → users-service edges under one request. With the shared cache in front,
   * most of those edges are now cache reads rather than HTTP — the N+1 stays visible in traces
   * while most of its cost moves off the network. When the cache is down, every one of them is
   * an HTTP call again: the fail-open path has to be sized for the fan-out, not for one call.
   * noCache threads through because a caller's freshness demand applies to every owner lookup
   * its request triggers, not the first.
   */
  private hydrateOwners(
    productsToHydrate: Product[],
    noCache: boolean,
  ): Promise<(Product | ProductWithOwner)[]> {
    return Promise.all(productsToHydrate.map((product) => this.withOwner(product, noCache)));
  }

  private async withOwner(product: Product, noCache: boolean): Promise<ProductWithOwner> {
    return { ...product, owner: await this.usersConnector.findOwner(product.ownerId, noCache) };
  }

  /**
   * Every list key that can exist right now: `all`, plus one per category in the store.
   *
   * `extraCategories` names shapes the store can no longer see — the old category of a product
   * that moved, the category of a deleted product — which is exactly when a naive "scan the
   * store" would skip a key that still has to die. A category that cannot form a key is skipped:
   * every read of it went uncached, so there is no entry to invalidate.
   */
  private listKeys(extraCategories: string[]): string[] {
    const categories = new Set([...products.map((product) => product.category), ...extraCategories]);
    return [undefined, ...categories]
      .map((category) => cacheKeyOrNull('productList', listShape(category)))
      .filter((key): key is string => key !== null);
  }

  /**
   * The write-side rule, deliberately blunt: **any write to any product kills every cached list
   * shape, and the written item's entry.** One `delMany`, one round trip, off the response path,
   * the removal count logged — a list cache invalidated wholesale cannot serve a stale member,
   * and there is no membership/content split to test or to get wrong. The cost is that the next
   * reader of *every* shape pays one store read; measured against the alternative's failure
   * mode — a stale list that nothing witnesses — that is a price worth paying until the metrics
   * say otherwise (see the docs for where "otherwise" starts).
   *
   * The keys are built inside the deferred callback, not before it: the store write has already
   * committed, and nothing about building cache keys may turn a committed write into a 500.
   */
  private invalidateAfterWrite(productId: string, extraCategories: string[] = []): void {
    setImmediate(() => {
      const itemKey = cacheKeyOrNull('product', productId);
      const keys = [
        ...this.listKeys(extraCategories),
        ...(itemKey ? [itemKey] : []),
        // The composite key is deterministic and this service's own — a write here can name it,
        // so it dies with the rest. Deleting it does not freshen the owner entries users-service
        // contributed to the *old* answer; it forces the next reader to rebuild the composite.
        requestKey('productCatalog', CATALOG_ROUTE, { expandOwner: true }),
      ];
      void this.cache.delMany(keys).then((removed) => {
        this.logger.debug(
          `Invalidation removed ${removed} cache entr${removed === 1 ? 'y' : 'ies'} after a write to product ${productId} ` +
            `(every list shape, the item's entry, and the catalog composite)`,
          `${CONTEXT}.invalidateAfterWrite`,
        );
      });
    });
  }
}
