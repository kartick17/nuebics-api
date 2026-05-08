import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import { Types } from 'mongoose';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TokenPayload } from '../shared/crypto/crypto.service';
import { throwIfError } from '../common/utils/throw-if-error';
import { FoldersService } from './folders.service';
import { createFolderSchema } from './dto/create-folder.schema';
import { updateFolderSchema } from './dto/update-folder.schema';

@Controller('files/folders')
@UseGuards(JwtAuthGuard)
export class FoldersController {
  constructor(private readonly foldersService: FoldersService) {}

  @Get()
  async list(
    @CurrentUser() auth: TokenPayload,
    @Query('parentId') parentId: string | undefined
  ) {
    const result = await this.foldersService.listFolders(auth.userId, parentId);
    throwIfError(result);
    return { folders: result.folders };
  }

  @Post()
  @HttpCode(201)
  async create(@CurrentUser() auth: TokenPayload, @Body() body: unknown) {
    const parsed = createFolderSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0].message);
    }
    const result = await this.foldersService.createFolder(
      auth.userId,
      parsed.data
    );
    throwIfError(result);
    return { folder: result.folder };
  }

  @Get(':id')
  async getOne(@CurrentUser() auth: TokenPayload, @Param('id') id: string) {
    const result = await this.foldersService.getFolder(auth.userId, id);
    throwIfError(result);
    return { folder: result.folder, breadcrumbs: result.breadcrumbs };
  }

  @Patch(':id')
  async update(
    @CurrentUser() auth: TokenPayload,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    if (!id || id === 'undefined' || !Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid folder ID');
    }

    const parsed = updateFolderSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0].message);
    }

    const result = await this.foldersService.updateFolder(
      auth.userId,
      id,
      parsed.data
    );
    throwIfError(result);
    return { folder: result.folder };
  }

  @Delete(':id')
  async remove(@CurrentUser() auth: TokenPayload, @Param('id') id: string) {
    const result = await this.foldersService.deleteFolder(auth.userId, id);
    throwIfError(result);
    return { success: result.success, message: result.message };
  }

  @Patch(':id/favourite')
  async favourite(
    @CurrentUser() auth: TokenPayload,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid folder ID');
    }

    if (
      typeof (body as Record<string, unknown>)?.['isFavourite'] !== 'boolean'
    ) {
      throw new BadRequestException('isFavourite must be a boolean');
    }

    const result = await this.foldersService.toggleFavourite(
      auth.userId,
      id,
      (body as Record<string, unknown>)['isFavourite'] as boolean
    );
    throwIfError(result);
    return { folder: result.folder };
  }
}
