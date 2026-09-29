import { CACHE_IDENTIFIER_PATTERN } from '@tw/cache';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Category ids to recompute.
 *
 * Duplicates collapse in the set and an id already queued is not re-added, so the response's
 * `queued` count separates "newly accepted" from "already pending".
 *
 * Every id becomes a queue member on the shared cache and a key segment for its stats entry, so
 * it is validated here with the key builder's own rule — `Widgets` or `home & garden` would
 * otherwise be queued, fetched from products-service under a spelling no cached shape answers
 * for, and dropped without a stats entry. The size limits bound what one request can add to a set
 * that is never evicted.
 */
export class RequestRecalculationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  @Matches(CACHE_IDENTIFIER_PATTERN, {
    each: true,
    message: 'each categoryId must be a canonical category id (lowercase letters, digits, ".", "_" or "-")',
  })
  categoryIds: string[];
}
