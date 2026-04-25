import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TrashService } from './trash.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TokenPayload } from '../shared/crypto/crypto.service';
import { Types } from 'mongoose';

@Controller('files/trash')
@UseGuards(JwtAuthGuard)
export class TrashController {
  constructor(private readonly trashService: TrashService) {}

  @Get()
  async listTrash(@CurrentUser() auth: TokenPayload) {
    return this.trashService.listTrash(auth.userId);
  }

  @Post('restore/:id')
  async restore(
    @Param('id') id: string,
    @Query('type') type: string,
    @CurrentUser() auth: TokenPayload,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid ID');
    }
    if (type !== 'file' && type !== 'folder') {
      throw new BadRequestException('type must be file or folder');
    }

    const result = await this.trashService.restoreItem(id, type, auth.userId);
    if (result === null) {
      const label = type === 'file' ? 'File' : 'Folder';
      throw new NotFoundException(`${label} not found in trash`);
    }
    return result;
  }
}
