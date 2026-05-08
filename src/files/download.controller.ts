import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards
} from '@nestjs/common';
import { Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TokenPayload } from '../shared/crypto/crypto.service';
import { File, FileDocument } from '../shared/database/schemas/file.schema';
import {
  Folder,
  FolderDocument
} from '../shared/database/schemas/folder.schema';
import { S3Service } from '../shared/s3/s3.service';
import { FoldersHelpers } from '../folders/folders.helpers';
import type { Env } from '../config/env.validation';

@Controller('files/download')
@UseGuards(JwtAuthGuard)
export class DownloadController {
  constructor(
    @InjectModel(File.name) private readonly fileModel: Model<FileDocument>,
    @InjectModel(Folder.name)
    private readonly folderModel: Model<FolderDocument>,
    private readonly s3: S3Service,
    private readonly foldersHelpers: FoldersHelpers,
    private readonly config: ConfigService<Env, true>
  ) {}

  // POST /api/files/download
  // Body: { fileIds?: string[], folderIds?: string[] }
  @Post()
  async batchDownload(
    @CurrentUser() auth: TokenPayload,
    @Body() body: unknown
  ) {
    const raw = body as Record<string, unknown>;
    const fileIds = raw?.['fileIds'] ?? [];
    const folderIds = raw?.['folderIds'] ?? [];

    if (!Array.isArray(fileIds) || !Array.isArray(folderIds)) {
      throw new BadRequestException('fileIds and folderIds must be arrays');
    }

    if (
      (fileIds as unknown[]).length === 0 &&
      (folderIds as unknown[]).length === 0
    ) {
      throw new BadRequestException('Provide at least one fileId or folderId');
    }

    const validFileIds = (fileIds as unknown[]).filter((id) =>
      Types.ObjectId.isValid(id as string)
    ) as string[];
    const validFolderIds = (folderIds as unknown[]).filter((id) =>
      Types.ObjectId.isValid(id as string)
    ) as string[];

    const { userId } = auth;

    const pathMap = new Map<string, string>();

    for (const folderId of validFolderIds) {
      const rootFolder = await this.folderModel
        .findOne(
          { _id: folderId, userId, status: 'active' },
          { _id: 1, name: 1 }
        )
        .lean();

      if (!rootFolder) continue;

      const descendantIds = await this.foldersHelpers.getDescendantFolderIds(
        folderId,
        userId
      );
      const allSubIds = [folderId, ...descendantIds];

      const subtreeFolders = await this.folderModel
        .find(
          { _id: { $in: allSubIds }, userId },
          { _id: 1, name: 1, parentId: 1 }
        )
        .lean();

      const folderDocMap = new Map(
        subtreeFolders.map((f) => [f._id.toString(), f])
      );

      const getRelativePath = (id: string): string => {
        if (id === folderId) return rootFolder.name;
        const f = folderDocMap.get(id);
        if (!f) return rootFolder.name;
        const parentId = f.parentId?.toString();
        if (!parentId || parentId === folderId)
          return `${rootFolder.name}/${f.name}`;
        return `${getRelativePath(parentId)}/${f.name}`;
      };

      const filesInSubtree = await this.fileModel
        .find(
          {
            userId,
            folderId: { $in: allSubIds.map((id) => new Types.ObjectId(id)) },
            status: 'active'
          },
          { _id: 1, key: 1, name: 1, folderId: 1 }
        )
        .lean();

      for (const file of filesInSubtree) {
        const fileId = file._id.toString();
        if (pathMap.has(fileId)) continue;
        const parentFolderId = file.folderId?.toString() ?? folderId;
        pathMap.set(fileId, getRelativePath(parentFolderId));
      }
    }

    for (const fileId of validFileIds) {
      if (!pathMap.has(fileId)) {
        pathMap.set(fileId, '');
      }
    }

    if (pathMap.size === 0) {
      return { items: [] };
    }

    const MAX_FILES = this.config.get('MAX_FILES', { infer: true });
    if (pathMap.size > MAX_FILES) {
      throw new BadRequestException(
        `Selection exceeds the ${MAX_FILES}-file download limit`
      );
    }

    const allFileIds = [...pathMap.keys()];
    const files = await this.fileModel
      .find(
        {
          _id: { $in: allFileIds.map((id) => new Types.ObjectId(id)) },
          userId,
          status: 'active'
        },
        { _id: 1, key: 1, name: 1 }
      )
      .lean();

    const items = await Promise.all(
      files.map(async (file) => {
        const url = await this.s3.presignGet(file.key, 300);
        const prefix = pathMap.get(file._id.toString()) ?? '';
        const path = prefix ? `${prefix}/${file.name}` : file.name;
        return { id: file._id.toString(), name: file.name, path, url };
      })
    );

    return { items };
  }

  // GET /api/files/download/:id
  @Get(':id')
  async singleDownload(
    @CurrentUser() auth: TokenPayload,
    @Param('id') id: string
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid file ID');
    }

    const file = await this.fileModel.findOne({ _id: id, userId: auth.userId });
    if (!file) {
      throw new NotFoundException('File not found');
    }

    const url = await this.s3.presignGet(file.key, 300);
    return { url };
  }
}
