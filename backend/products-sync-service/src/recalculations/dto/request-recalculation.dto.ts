import { ArrayMinSize, IsArray, IsString } from 'class-validator';

/**
 * Category ids to recompute.
 *
 * Duplicates collapse in the set and an id already queued is not re-added, so the response's
 * `queued` count separates "newly accepted" from "already pending".
 */
export class RequestRecalculationDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  categoryIds: string[];
}