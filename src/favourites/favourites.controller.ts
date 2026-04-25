import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
    return this.favouritesService.listFavourites(auth.userId);
  }

  @Patch('bulk')
  async bulkToggle(
    @CurrentUser() auth: TokenPayload,
    @Body() body: { fileIds?: unknown; folderIds?: unknown; isFavourite?: unknown },
  ) {
    const { fileIds = [], folderIds = [], isFavourite } = body;

    if (typeof isFavourite !== 'boolean') {
      throw new BadRequestException('isFavourite must be a boolean');
    }
    if (!Array.isArray(fileIds) || !Array.isArray(folderIds)) {
      throw new BadRequestException('fileIds and folderIds must be arrays');
    }
    if ((fileIds as unknown[]).length === 0 && (folderIds as unknown[]).length === 0) {
      throw new BadRequestException('Provide at least one fileId or folderId');
    }

    return this.favouritesService.bulkToggle(
      auth.userId,
      fileIds as string[],
      folderIds as string[],
      isFavourite,
    );
  }
}
