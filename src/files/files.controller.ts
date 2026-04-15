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
  async upload(
    @CurrentUser() auth: TokenPayload,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const parsed = uploadSchema.safeParse(body);
      const raw = body as Record<string, unknown>;

      if (!raw?.['fileName'] || !raw?.['fileType'] || !raw?.['fileSize']) {
        res.status(400);
        return { error: 'fileName, fileType and fileSize are required' };
      }

      if (!parsed.success) {
        res.status(400);
        return { error: parsed.error.issues[0].message };
      }

      const result = await this.filesService.presignUpload(auth.userId, parsed.data);
      if ('error' in result) {
        res.status(result.status as number);
        return { error: result.error };
      }
      return result;
    } catch (err) {
      console.error('POST /api/files/upload error:', err);
      res.status(500);
      return { error: 'Upload failed' };
    }
  }

  // POST /api/files/confirm
  @Post('confirm')
  async confirm(
    @CurrentUser() auth: TokenPayload,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const raw = body as Record<string, unknown>;

      if (!raw?.['key'] || !raw?.['fileName'] || !raw?.['fileType'] || !raw?.['fileSize']) {
        res.status(400);
        return { error: 'key, fileName, fileType and fileSize are required' };
      }

      const parsed = confirmSchema.safeParse(body);
      if (!parsed.success) {
        res.status(400);
        return { error: parsed.error.issues[0].message };
      }

      const result = await this.filesService.confirmUpload(auth.userId, parsed.data);
      if ('error' in result) {
        res.status(result.status as number);
        return { error: result.error };
      }
      res.status(201);
      return { file: result.file };
    } catch (err) {
      console.error('POST /api/files/confirm error:', err);
      res.status(500);
      return { error: 'Failed to confirm upload' };
    }
  }

  // GET /api/files/files?folderId=<id|null>
  @Get('files')
  async listFiles(
    @CurrentUser() auth: TokenPayload,
    @Query('folderId') folderId: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const result = await this.filesService.listFiles(auth.userId, folderId);
      if ('error' in result) {
        res.status(result.status as number);
        return { error: result.error };
      }
      return { files: result.files };
    } catch (err) {
      console.error('GET /api/files/files error:', err);
      res.status(500);
      return { error: 'Failed to fetch files' };
    }
  }

  // PATCH /api/files/files/:id
  @Patch('files/:id')
  async updateFile(
    @CurrentUser() auth: TokenPayload,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      if (!Types.ObjectId.isValid(id)) {
        res.status(400);
        return { error: 'Invalid file ID' };
      }

      const parsed = updateFileSchema.safeParse(body);
      if (!parsed.success) {
        res.status(400);
        return { error: parsed.error.issues[0].message };
      }

      const result = await this.filesService.updateFile(auth.userId, id, parsed.data);
      if ('error' in result) {
        res.status(result.status as number);
        return { error: result.error };
      }
      return { file: result.file };
    } catch (err) {
      console.error('PATCH /api/files/files/:id error:', err);
      res.status(500);
      return { error: 'Failed to update file' };
    }
  }

  // DELETE /api/files/files/:id
  @Delete('files/:id')
  async deleteFile(
    @CurrentUser() auth: TokenPayload,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      if (!Types.ObjectId.isValid(id)) {
        res.status(400);
        return { error: 'Invalid file ID' };
      }

      const result = await this.filesService.deleteFile(auth.userId, id);
      if ('error' in result) {
        res.status(result.status as number);
        return { error: result.error };
      }
      return { success: result.success, message: result.message };
    } catch (err) {
      console.error('DELETE /api/files/files/:id error:', err);
      res.status(500);
      return { error: 'Failed to delete file' };
    }
  }

  // PATCH /api/files/files/:id/favourite
  @Patch('files/:id/favourite')
  async toggleFavourite(
    @CurrentUser() auth: TokenPayload,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      if (!Types.ObjectId.isValid(id)) {
        res.status(400);
        return { error: 'Invalid file ID' };
      }

      if (typeof (body as Record<string, unknown>)?.['isFavourite'] !== 'boolean') {
        res.status(400);
        return { error: 'isFavourite must be a boolean' };
      }

      const result = await this.filesService.toggleFavourite(
        auth.userId,
        id,
        (body as Record<string, unknown>)['isFavourite'] as boolean,
      );
      if ('error' in result) {
        res.status(result.status as number);
        return { error: result.error };
      }
      return { file: result.file };
    } catch (err) {
      console.error('PATCH /api/files/files/:id/favourite error:', err);
      res.status(500);
      return { error: 'Failed to update favourite' };
    }
  }
}
