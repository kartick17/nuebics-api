import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { File, FileDocument } from '../shared/database/schemas/file.schema';
import {
  Folder,
  FolderDocument
} from '../shared/database/schemas/folder.schema';
import { StratusService } from '../shared/stratus/stratus.service';
import type { Env } from '../config/env.validation';

@Injectable()
export class FoldersHelpers {
  constructor(
    @InjectModel(File.name) private readonly fileModel: Model<FileDocument>,
    @InjectModel(Folder.name)
    private readonly folderModel: Model<FolderDocument>,
    private readonly stratus: StratusService,
    private readonly config: ConfigService<Env, true>
  ) {}

  get trashRetentionMs(): number {
    return this.config.get('NODE_ENV', { infer: true }) === 'production'
      ? 30 * 24 * 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;
  }

  async trashFolderRecursive(folderId: string, userId: string): Promise<void> {
    const now = new Date();
    const oid = new Types.ObjectId(folderId);
    await this.fileModel.updateMany(
      { userId, folderId: oid, status: 'active' },
      { status: 'trashed', deletedAt: now }
    );
    const subs = await this.folderModel
      .find({ userId, parentId: oid, status: 'active' })
      .lean();
    for (const s of subs)
      await this.trashFolderRecursive(s._id.toString(), userId);
    await this.folderModel.findOneAndUpdate(
      { _id: folderId, userId },
      { status: 'trashed', deletedAt: now }
    );
  }

  async getDescendantFolderIds(
    folderId: string,
    userId: string
  ): Promise<string[]> {
    const out: string[] = [];
    const queue = [folderId];
    while (queue.length) {
      const curr = queue.shift()!;
      const kids = await this.folderModel
        .find({ parentId: curr, userId }, { _id: 1 })
        .lean();
      for (const k of kids) {
        out.push(k._id.toString());
        queue.push(k._id.toString());
      }
    }
    return out;
  }

  async isDescendantOf(
    targetId: string,
    ancestorId: string,
    userId: string
  ): Promise<boolean> {
    if (targetId === ancestorId) return true;
    const desc = await this.getDescendantFolderIds(ancestorId, userId);
    return desc.includes(targetId);
  }

  async deleteFolderRecursive(folderId: string, userId: string) {
    const desc = await this.getDescendantFolderIds(folderId, userId);
    const all = [folderId, ...desc];
    const files = await this.fileModel
      .find({ userId, folderId: { $in: all } }, { _id: 1, key: 1 })
      .lean();
    await this.stratus.deleteMany(files.map((f) => f.key));
    const fileResult = await this.fileModel.deleteMany({
      userId,
      folderId: { $in: all }
    });
    const folderResult = await this.folderModel.deleteMany({
      userId,
      _id: { $in: all }
    });
    return {
      deletedFolders: folderResult.deletedCount,
      deletedFiles: fileResult.deletedCount
    };
  }

  async buildBreadcrumbPath(folderId: string | null, userId: string) {
    const path: { _id: string | null; name: string }[] = [];
    let curr = folderId;
    while (curr) {
      const f = await this.folderModel
        .findOne({ _id: curr, userId }, { _id: 1, name: 1, parentId: 1 })
        .lean();
      if (!f) break;
      path.unshift({ _id: f._id.toString(), name: f.name });
      curr = f.parentId?.toString() ?? null;
    }
    path.unshift({ _id: null, name: 'Home' });
    return path;
  }

  async restoreFolderRecursive(
    folderId: string,
    userId: string
  ): Promise<void> {
    const oid = new Types.ObjectId(folderId);
    await this.fileModel.updateMany(
      { userId, folderId: oid, status: 'trashed' },
      { status: 'active', deletedAt: null }
    );
    const subs = await this.folderModel
      .find({ userId, parentId: oid, status: 'trashed' })
      .lean();
    for (const s of subs)
      await this.restoreFolderRecursive(s._id.toString(), userId);
    await this.folderModel.findOneAndUpdate(
      { _id: folderId, userId },
      { status: 'active', deletedAt: null }
    );
  }

  async purgeExpiredTrash(userId?: string) {
    const cutoff = new Date(Date.now() - this.trashRetentionMs);
    const userFilter = userId ? { userId } : {};
    const expiredFiles = await this.fileModel
      .find({ ...userFilter, status: 'trashed', deletedAt: { $lte: cutoff } })
      .lean();
    await this.stratus.deleteMany(expiredFiles.map((f) => f.key));
    const { deletedCount: df = 0 } = await this.fileModel.deleteMany({
      ...userFilter,
      status: 'trashed',
      deletedAt: { $lte: cutoff }
    });
    const { deletedCount: dfd = 0 } = await this.folderModel.deleteMany({
      ...userFilter,
      status: 'trashed',
      deletedAt: { $lte: cutoff }
    });
    return { files: df, folders: dfd };
  }
}
