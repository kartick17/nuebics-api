import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { File, FileDocument } from '../shared/database/schemas/file.schema';
import { Folder, FolderDocument } from '../shared/database/schemas/folder.schema';
import { FoldersHelpers } from '../folders/folders.helpers';

@Injectable()
export class TrashService {
  constructor(
    @InjectModel(File.name) private readonly fileModel: Model<FileDocument>,
    @InjectModel(Folder.name) private readonly folderModel: Model<FolderDocument>,
    private readonly foldersHelpers: FoldersHelpers,
  ) {}

  async listTrash(userId: string) {
    const trashedFolderIds = await this.folderModel
      .find({ userId, status: 'trashed' })
      .distinct('_id');

    const [rootFolders, rootFiles] = await Promise.all([
      this.folderModel
        .find({
          userId,
          status: 'trashed',
          $or: [{ parentId: null }, { parentId: { $nin: trashedFolderIds } }],
        })
        .sort({ deletedAt: -1 })
        .lean(),
      this.fileModel
        .find({
          userId,
          status: 'trashed',
          $or: [{ folderId: null }, { folderId: { $nin: trashedFolderIds } }],
        })
        .sort({ deletedAt: -1 })
        .lean(),
    ]);

    const folderIds = rootFolders.map((f) => f._id);

    const [subFileCounts, subFolderCounts] = await Promise.all([
      this.fileModel.aggregate([
        { $match: { userId, status: 'trashed', folderId: { $in: folderIds } } },
        { $group: { _id: '$folderId', count: { $sum: 1 } } },
      ]),
      this.folderModel.aggregate([
        { $match: { userId, status: 'trashed', parentId: { $in: folderIds } } },
        { $group: { _id: '$parentId', count: { $sum: 1 } } },
      ]),
    ]);

    const countMap = new Map<string, number>();
    for (const { _id, count } of subFileCounts) {
      const k = (_id as Types.ObjectId).toString();
      countMap.set(k, (countMap.get(k) ?? 0) + count);
    }
    for (const { _id, count } of subFolderCounts) {
      const k = (_id as Types.ObjectId).toString();
      countMap.set(k, (countMap.get(k) ?? 0) + count);
    }

    const foldersWithCount = rootFolders.map((f) => ({
      ...f,
      childCount: countMap.get(f._id.toString()) ?? 0,
    }));

    const retentionDays = this.foldersHelpers.trashRetentionMs / (24 * 60 * 60 * 1000);

    return { folders: foldersWithCount, files: rootFiles, retentionDays };
  }

  async restoreItem(id: string, type: 'file' | 'folder', userId: string) {
    if (type === 'file') {
      const file = await this.fileModel.findOne({ _id: id, userId, status: 'trashed' });
      if (!file) return null;

      file.status = 'active';
      file.deletedAt = null;
      await file.save();

      return { success: true, message: `${file.name} restored` };
    }

    const folder = await this.folderModel.findOne({ _id: id, userId, status: 'trashed' });
    if (!folder) return null;

    await this.foldersHelpers.restoreFolderRecursive(id, userId);

    return { success: true, message: `${folder.name} restored` };
  }
}
