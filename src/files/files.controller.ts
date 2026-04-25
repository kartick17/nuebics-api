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
  UseGuards,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TokenPayload } from '../shared/crypto/crypto.service';
import { throwIfError } from '../common/utils/throw-if-error';
import { FilesService } from './files.service';
import { uploadSchema } from './dto/upload.schema';
import { confirmSchema } from './dto/confirm.schema';
import { updateFileSchema } from './dto/update-file.schema';

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  // POST /api/files/upload
  @Post('upload')
  async upload(@CurrentUser() auth: TokenPayload, @Body() body: unknown) {
    const raw = body as Record<string, unknown>;
    if (!raw?.['fileName'] || !raw?.['fileType'] || !raw?.['fileSize']) {
      throw new BadRequestException('fileName, fileType and fileSize are required');
    }

    const parsed = uploadSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0].message);
    }

    const result = await this.filesService.presignUpload(auth.userId, parsed.data);
    throwIfError(result);
    return result;
  }

  // POST /api/files/confirm
  @Post('confirm')
  @HttpCode(201)
  async confirm(@CurrentUser() auth: TokenPayload, @Body() body: unknown) {
    const raw = body as Record<string, unknown>;
    if (!raw?.['key'] || !raw?.['fileName'] || !raw?.['fileType'] || !raw?.['fileSize']) {
      throw new BadRequestException('key, fileName, fileType and fileSize are required');
    }

    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0].message);
    }

    const result = await this.filesService.confirmUpload(auth.userId, parsed.data);
    throwIfError(result);
    return { file: result.file };
  }

  // GET /api/files/files?folderId=<id|null>
  @Get('files')
  async listFiles(
    @CurrentUser() auth: TokenPayload,
    @Query('folderId') folderId: string | undefined,
  ) {
    const result = await this.filesService.listFiles(auth.userId, folderId);
    throwIfError(result);
    return { files: result.files };
  }

  // PATCH /api/files/files/:id
  @Patch('files/:id')
  async updateFile(
    @CurrentUser() auth: TokenPayload,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid file ID');
    }

    const parsed = updateFileSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0].message);
    }

    const result = await this.filesService.updateFile(auth.userId, id, parsed.data);
    throwIfError(result);
    return { file: result.file };
  }

  // DELETE /api/files/files/:id
  @Delete('files/:id')
  async deleteFile(@CurrentUser() auth: TokenPayload, @Param('id') id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid file ID');
    }

    const result = await this.filesService.deleteFile(auth.userId, id);
    throwIfError(result);
    return { success: result.success, message: result.message };
  }

  // PATCH /api/files/files/:id/favourite
  @Patch('files/:id/favourite')
  async toggleFavourite(
    @CurrentUser() auth: TokenPayload,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid file ID');
    }

    if (typeof (body as Record<string, unknown>)?.['isFavourite'] !== 'boolean') {
      throw new BadRequestException('isFavourite must be a boolean');
    }

    const result = await this.filesService.toggleFavourite(
      auth.userId,
      id,
      (body as Record<string, unknown>)['isFavourite'] as boolean,
    );
    throwIfError(result);
    return { file: result.file };
  }
}
