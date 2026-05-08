import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Query,
  UseGuards
} from '@nestjs/common';
import { Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TokenPayload } from '../shared/crypto/crypto.service';
import { File, FileDocument } from '../shared/database/schemas/file.schema';
import {
  Folder,
  FolderDocument
} from '../shared/database/schemas/folder.schema';
import { FoldersHelpers } from '../folders/folders.helpers';

@Controller('files/contents')
@UseGuards(JwtAuthGuard)
export class ContentsController {
  constructor(
    @InjectModel(File.name) private readonly fileModel: Model<FileDocument>,
    @InjectModel(Folder.name)
    private readonly folderModel: Model<FolderDocument>,
    private readonly foldersHelpers: FoldersHelpers
  ) {}

  // GET /api/files/contents?folderId=<id|null>
  @Get()
  async getContents(
    @CurrentUser() auth: TokenPayload,
    @Query('folderId') folderIdParam: string | undefined
  ) {
    const { userId } = auth;

    let folderId: Types.ObjectId | null = null;
    if (folderIdParam && folderIdParam !== 'null') {
      if (!Types.ObjectId.isValid(folderIdParam)) {
        throw new BadRequestException('Invalid folderId');
      }

      const folder = await this.folderModel
        .findOne({ _id: folderIdParam, userId })
        .lean();

      if (!folder) {
        throw new NotFoundException('Folder not found');
      }

      folderId = new Types.ObjectId(folderIdParam);
    }

    const [folders, files, breadcrumbs] = await Promise.all([
      this.folderModel
        .find({ userId, parentId: folderId, status: 'active' })
        .sort({ name: 1 })
        .lean(),
      this.fileModel
        .find({ userId, folderId, status: 'active' })
        .sort({ updatedAt: -1 })
        .lean(),
      this.foldersHelpers.buildBreadcrumbPath(folderIdParam ?? null, userId)
    ]);

    const folderIds = folders.map((f) => f._id);

    const [subfolderCounts, fileCounts] = await Promise.all([
      this.folderModel.aggregate([
        {
          $match: {
            userId,
            parentId: { $in: folderIds },
            status: 'active'
          }
        },
        { $group: { _id: '$parentId', count: { $sum: 1 } } }
      ]),
      this.fileModel.aggregate([
        {
          $match: {
            userId,
            folderId: { $in: folderIds },
            status: 'active'
          }
        },
        { $group: { _id: '$folderId', count: { $sum: 1 } } }
      ])
    ]);

    const countMap = new Map<string, number>();
    for (const { _id, count } of subfolderCounts as {
      _id: Types.ObjectId;
      count: number;
    }[]) {
      const key = _id.toString();
      countMap.set(key, (countMap.get(key) ?? 0) + count);
    }
    for (const { _id, count } of fileCounts as {
      _id: Types.ObjectId;
      count: number;
    }[]) {
      const key = _id.toString();
      countMap.set(key, (countMap.get(key) ?? 0) + count);
    }

    const foldersWithCount = folders.map((f) => ({
      ...f,
      itemCount: countMap.get(f._id.toString()) ?? 0
    }));

    return { folders: foldersWithCount, files, breadcrumbs };
  }
}
