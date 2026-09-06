import { IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class UpdateProductDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() @MinLength(1) category?: string;
  @IsOptional() @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsInt() @Min(0) stock?: number;
  @IsOptional() @IsString() @MinLength(1) ownerId?: string;
}
