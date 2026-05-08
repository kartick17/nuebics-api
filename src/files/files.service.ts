import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { File, FileDocument } from '../shared/database/schemas/file.schema';
import {
  Folder,
  FolderDocument
} from '../shared/database/schemas/folder.schema';
import { S3Service } from '../shared/s3/s3.service';
import type { Env } from '../config/env.validation';
import type { UploadInput } from './dto/upload.schema';
import type { ConfirmInput } from './dto/confirm.schema';
import type { UpdateFileInput } from './dto/update-file.schema';

@Injectable()
export class FilesService {
  constructor(
    @InjectModel(File.name) private readonly fileModel: Model<FileDocument>,
    @InjectModel(Folder.name)
    private readonly folderModel: Model<FolderDocument>,
    private readonly s3: S3Service,
    private readonly config: ConfigService<Env, true>
  ) {}

  async presignUpload(userId: string, dto: UploadInput) {
    const { fileName, fileType, folderId } = dto;

    let resolvedFolderId: Types.ObjectId | null = null;
    if (folderId && folderId !== 'null') {
      if (!Types.ObjectId.isValid(folderId)) {
        return { error: 'Invalid folderId', status: 400 } as const;
      }
      const folder = await this.folderModel.findOne({ _id: folderId, userId });
      if (!folder) {
        return { error: 'Target folder not found', status: 404 } as const;
      }
      resolvedFolderId = new Types.ObjectId(folderId);
    }

    const ext = fileName.split('.').pop();
    const key = `uploads/${userId}/${uuidv4()}.${ext}`;
    const presignedUrl = await this.s3.presignPut(key, fileType, 300);

    return {
      presignedUrl,
      key,
      folderId: resolvedFolderId?.toString() ?? null
    } as const;
  }

  async confirmUpload(userId: string, dto: ConfirmInput) {
    const { key, fileName, fileType, fileSize, folderId } = dto;

    let headResult: Awaited<ReturnType<typeof this.s3.head>>;
    try {
      headResult = await this.s3.head(key);
    } catch {
      return {
        error: 'File not found in S3 — upload may have failed',
        status: 400
      } as const;
    }

    if (headResult.ContentLength !== fileSize) {
      await this.s3.deleteOne(key);
      return {
        error: 'Upload appears incomplete — please try again',
        status: 400
      } as const;
    }

    const file = await this.fileModel.create({
      key,
      userId,
      name: fileName,
      size: fileSize,
      type: fileType,
      folderId: folderId ? new Types.ObjectId(folderId) : null,
      status: 'active',
      deletedAt: null
    });

    return { file, status: 201 } as const;
  }

  async listFiles(userId: string, folderIdParam: string | undefined) {
    const filter: Record<string, unknown> = { userId };

    if (folderIdParam && folderIdParam !== 'null') {
      if (!Types.ObjectId.isValid(folderIdParam)) {
        return { error: 'Invalid folderId', status: 400 } as const;
      }
      filter.folderId = new Types.ObjectId(folderIdParam);
    } else {
      filter.folderId = null;
    }

    const files = await this.fileModel
      .find({ ...filter, status: 'active' })
      .sort({ updatedAt: -1 })
      .lean();

    return { files } as const;
  }

  async updateFile(userId: string, id: string, dto: UpdateFileInput) {
    const { name, folderId } = dto;

    if (name === undefined && folderId === undefined) {
      return {
        error: 'Nothing to update — provide name or folderId',
        status: 400
      } as const;
    }

    const file = await this.fileModel.findOne({ _id: id, userId });
    if (!file) {
      return { error: 'File not found', status: 404 } as const;
    }

    if (folderId !== undefined) {
      if (folderId !== null) {
        if (!Types.ObjectId.isValid(folderId)) {
          return { error: 'Invalid folderId', status: 400 } as const;
        }
        const targetFolder = await this.folderModel.findOne({
          _id: folderId,
          userId
        });
        if (!targetFolder) {
          return { error: 'Target folder not found', status: 404 } as const;
        }
      }
      file.folderId = folderId ? new Types.ObjectId(folderId) : null;
    }

    if (name !== undefined) {
      file.name = name;
    }

    await file.save();
    return { file } as const;
  }

  async deleteFile(userId: string, id: string) {
    const file = await this.fileModel.findOne({
      _id: id,
      userId,
      status: 'active'
    });
    if (!file) {
      return { error: 'File not found', status: 404 } as const;
    }

    file.status = 'trashed';
    file.deletedAt = new Date();
    await file.save();

    return { success: true, message: `${file.name} moved to trash` } as const;
  }

  async toggleFavourite(userId: string, id: string, isFavourite: boolean) {
    const file = await this.fileModel.findOneAndUpdate(
      { _id: id, userId, status: 'active' },
      { isFavourite },
      { new: true }
    );

    if (!file) {
      return { error: 'File not found', status: 404 } as const;
    }

    return { file } as const;
  }

  async presignDownloadSingle(userId: string, id: string) {
    const file = await this.fileModel.findOne({ _id: id, userId });
    if (!file) {
      return { error: 'File not found', status: 404 } as const;
    }

    const url = await this.s3.presignGet(file.key, 300);
    return { url } as const;
  }

  get maxFiles(): number {
    return this.config.get('MAX_FILES', { infer: true });
  }
}
