import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  InternalServerErrorException,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { FavouritesService } from './favourites.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TokenPayload } from '../shared/crypto/crypto.service';

@Controller('files/favourites')
@UseGuards(JwtAuthGuard)
export class FavouritesController {
  constructor(private readonly favouritesService: FavouritesService) {}

  @Get()
  async listFavourites(@CurrentUser() auth: TokenPayload) {
    try {
      return await this.favouritesService.listFavourites(auth.userId);
    } catch {
      throw new InternalServerErrorException({ error: 'Failed to fetch favourites' });
    }
  }

  @Patch('bulk')
  async bulkToggle(
    @CurrentUser() auth: TokenPayload,
    @Body() body: { fileIds?: unknown; folderIds?: unknown; isFavourite?: unknown },
  ) {
    const { fileIds = [], folderIds = [], isFavourite } = body;

    if (typeof isFavourite !== 'boolean') {
      throw new BadRequestException({ error: 'isFavourite must be a boolean' });
    }
    if (!Array.isArray(fileIds) || !Array.isArray(folderIds)) {
      throw new BadRequestException({ error: 'fileIds and folderIds must be arrays' });
    }
    if ((fileIds as unknown[]).length === 0 && (folderIds as unknown[]).length === 0) {
      throw new BadRequestException({ error: 'Provide at least one fileId or folderId' });
    }

    try {
      return await this.favouritesService.bulkToggle(
        auth.userId,
        fileIds as string[],
        folderIds as string[],
        isFavourite,
      );
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new InternalServerErrorException({ error: 'Failed to update favourites' });
    }
  }
}
