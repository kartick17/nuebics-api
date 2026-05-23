import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TokenPayload } from '../shared/crypto/crypto.service';
import { SearchService } from './search.service';
import { searchSchema } from './dto/search.schema';

@Controller('search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  // GET /api/search?q=...&page=...&limit=...&includeTrashed=...
  @Get()
  async search(
    @CurrentUser() auth: TokenPayload,
    @Query() query: Record<string, unknown>
  ) {
    const parsed = searchSchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0].message);
    }

    return this.searchService.search(auth.userId, parsed.data);
  }
}
