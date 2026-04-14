import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Types } from 'mongoose';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TokenPayload } from '../shared/crypto/crypto.service';
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
    @Query('parentId') parentId: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.foldersService.listFolders(auth.userId, parentId);
    if ('error' in result) {
      res.status(result.status as number);
      return { error: result.error };
    }
    return { folders: result.folders };
  }

  @Post()
  async create(
    @CurrentUser() auth: TokenPayload,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = createFolderSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400);
      return { error: parsed.error.issues[0].message };
    }
    const result = await this.foldersService.createFolder(auth.userId, parsed.data);
    if ('error' in result) {
      res.status(result.status);
      return { error: result.error };
    }
    res.status(201);
    return { folder: result.folder };
  }

  @Get(':id')
  async getOne(
    @CurrentUser() auth: TokenPayload,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.foldersService.getFolder(auth.userId, id);
    if ('error' in result) {
      res.status(result.status);
      return { error: result.error };
    }
    return { folder: result.folder, breadcrumbs: result.breadcrumbs };
  }

  @Patch(':id')
  async update(
    @CurrentUser() auth: TokenPayload,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!id || id === 'undefined') {
      res.status(400);
      return { error: 'Invalid folder ID' };
    }

    const parsed = updateFolderSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400);
      return { error: parsed.error.issues[0].message };
    }

    // validate id before handing off to service
    if (!Types.ObjectId.isValid(id)) {
      res.status(400);
      return { error: 'Invalid folder ID' };
    }

    const result = await this.foldersService.updateFolder(auth.userId, id, parsed.data);
    if ('error' in result) {
      res.status(result.status);
      return { error: result.error };
    }
    return { folder: result.folder };
  }

  @Delete(':id')
  async remove(
    @CurrentUser() auth: TokenPayload,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.foldersService.deleteFolder(auth.userId, id);
    if ('error' in result) {
      res.status(result.status);
      return { error: result.error };
    }
    return { success: result.success, message: result.message };
  }

  @Patch(':id/favourite')
  async favourite(
    @CurrentUser() auth: TokenPayload,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      res.status(400);
      return { error: 'Invalid folder ID' };
    }

    if (typeof (body as any)?.isFavourite !== 'boolean') {
      res.status(400);
      return { error: 'isFavourite must be a boolean' };
    }

    const result = await this.foldersService.toggleFavourite(
      auth.userId,
      id,
      (body as any).isFavourite as boolean,
    );
    if ('error' in result) {
      res.status(result.status);
      return { error: result.error };
    }
    return { folder: result.folder };
  }
}
