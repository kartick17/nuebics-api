import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { File, FileDocument } from '../shared/database/schemas/file.schema';
import {
  Folder,
  FolderDocument
} from '../shared/database/schemas/folder.schema';

@Injectable()
export class FavouritesService {
  constructor(
    @InjectModel(File.name) private readonly fileModel: Model<FileDocument>,
    @InjectModel(Folder.name)
    private readonly folderModel: Model<FolderDocument>
  ) {}

  async listFavourites(userId: string) {
    const [files, folders] = await Promise.all([
      this.fileModel
        .find({ userId, isFavourite: true, status: 'active' })
        .sort({ updatedAt: -1 })
        .lean(),
      this.folderModel
        .find({ userId, isFavourite: true, status: 'active' })
        .sort({ name: 1 })
        .lean()
    ]);

    return { files, folders };
  }

  async bulkToggle(
    userId: string,
    fileIds: string[],
    folderIds: string[],
    isFavourite: boolean
  ) {
    const validFileIds = fileIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    const validFolderIds = folderIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    const [fileResult, folderResult] = await Promise.all([
      validFileIds.length > 0
        ? this.fileModel.updateMany(
            { _id: { $in: validFileIds }, userId, status: 'active' },
            { isFavourite }
          )
        : Promise.resolve({ modifiedCount: 0 }),

      validFolderIds.length > 0
        ? this.folderModel.updateMany(
            { _id: { $in: validFolderIds }, userId, status: 'active' },
            { isFavourite }
          )
        : Promise.resolve({ modifiedCount: 0 })
    ]);

    return {
      updated: {
        files: fileResult.modifiedCount,
        folders: folderResult.modifiedCount
      }
    };
  }
}
