import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { File, FileDocument } from '../shared/database/schemas/file.schema';
import {
  Folder,
  FolderDocument
} from '../shared/database/schemas/folder.schema';
import type { SearchInput } from './dto/search.schema';

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class SearchService {
  constructor(
    @InjectModel(File.name) private readonly fileModel: Model<FileDocument>,
    @InjectModel(Folder.name)
    private readonly folderModel: Model<FolderDocument>
  ) {}

  async search(userId: string, input: SearchInput) {
    const { q, page, limit, includeTrashed } = input;
    const escaped = escapeRegex(q);
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {
      userId,
      name: { $regex: escaped, $options: 'i' }
    };
    if (!includeTrashed) {
      filter.status = 'active';
    }

    const [fileTotal, fileItems, folderTotal, folderItems] = await Promise.all([
      this.fileModel.countDocuments(filter).exec(),
      this.fileModel
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.folderModel.countDocuments(filter).exec(),
      this.folderModel
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    return {
      query: q,
      files: { items: fileItems, page, limit, total: fileTotal },
      folders: { items: folderItems, page, limit, total: folderTotal }
    } as const;
  }
}
