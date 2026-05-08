import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Folder,
  FolderDocument
} from '../shared/database/schemas/folder.schema';
import { FoldersHelpers } from './folders.helpers';
import type { CreateFolderInput } from './dto/create-folder.schema';
import type { UpdateFolderInput } from './dto/update-folder.schema';

@Injectable()
export class FoldersService {
  constructor(
    @InjectModel(Folder.name)
    private readonly folderModel: Model<FolderDocument>,
    private readonly helpers: FoldersHelpers
  ) {}

  async listFolders(userId: string, parentIdParam: string | null | undefined) {
    let parentId: Types.ObjectId | null = null;
    if (parentIdParam && parentIdParam !== 'null') {
      if (!Types.ObjectId.isValid(parentIdParam)) {
        return { error: 'Invalid parentId', status: 400 } as const;
      }
      parentId = new Types.ObjectId(parentIdParam);
    }
    const folders = await this.folderModel
      .find({ userId, parentId, status: 'active' })
      .sort({ name: 1 })
      .lean();
    return { folders };
  }

  async createFolder(userId: string, dto: CreateFolderInput) {
    const { name, parentId } = dto;

    if (parentId) {
      if (!Types.ObjectId.isValid(parentId)) {
        return { error: 'Invalid parentId', status: 400 } as const;
      }
      const parentFolder = await this.folderModel.findOne({
        _id: parentId,
        userId
      });
      if (!parentFolder) {
        return { error: 'Parent folder not found', status: 404 } as const;
      }
    }

    const existing = await this.folderModel.findOne({
      userId,
      parentId: parentId ?? null,
      name
    });
    if (existing) {
      return {
        error: 'A folder with this name already exists here',
        status: 409
      } as const;
    }

    const folder = await this.folderModel.create({
      userId,
      name,
      parentId: parentId ? new Types.ObjectId(parentId) : null
    });
    return { folder, status: 201 } as const;
  }

  async getFolder(userId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) {
      return { error: 'Invalid folder ID', status: 400 } as const;
    }
    const folder = await this.folderModel.findOne({ _id: id, userId }).lean();
    if (!folder) {
      return { error: 'Folder not found', status: 404 } as const;
    }
    const breadcrumbs = await this.helpers.buildBreadcrumbPath(id, userId);
    return { folder, breadcrumbs, status: 200 } as const;
  }

  async updateFolder(userId: string, id: string, dto: UpdateFolderInput) {
    const { name, parentId } = dto;

    if (name === undefined && parentId === undefined) {
      return {
        error: 'Nothing to update — provide name or parentId',
        status: 400
      } as const;
    }

    const folder = await this.folderModel.findOne({ _id: id, userId });
    if (!folder) {
      return { error: 'Folder not found', status: 404 } as const;
    }

    if (parentId !== undefined) {
      const newParentId = parentId;
      const currentParent = folder.parentId?.toString() ?? null;

      if (newParentId === currentParent) {
        return {
          error: 'Folder is already in this location',
          status: 400
        } as const;
      }

      if (newParentId === id) {
        return {
          error: 'Cannot move a folder into itself',
          status: 400
        } as const;
      }

      if (newParentId !== null) {
        if (!Types.ObjectId.isValid(newParentId)) {
          return { error: 'Invalid parentId', status: 400 } as const;
        }

        const isCircular = await this.helpers.isDescendantOf(
          newParentId,
          id,
          userId
        );
        if (isCircular) {
          return {
            error: 'Cannot move a folder into one of its subfolders',
            status: 400
          } as const;
        }

        const targetParent = await this.folderModel.findOne({
          _id: newParentId,
          userId
        });
        if (!targetParent) {
          return { error: 'Target folder not found', status: 404 } as const;
        }
      }

      folder.parentId = newParentId ? new Types.ObjectId(newParentId) : null;
    }

    if (name !== undefined) {
      const targetParentId = folder.parentId?.toString() ?? null;

      const duplicate = await this.folderModel.findOne({
        userId,
        parentId: targetParentId ? new Types.ObjectId(targetParentId) : null,
        name,
        _id: { $ne: id }
      });

      if (duplicate) {
        return {
          error: 'A folder with this name already exists here',
          status: 409
        } as const;
      }

      folder.name = name;
    }

    await folder.save();
    return { folder, status: 200 } as const;
  }

  async deleteFolder(userId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) {
      return { error: 'Invalid folder ID', status: 400 } as const;
    }
    const folder = await this.folderModel.findOne({
      _id: id,
      userId,
      status: 'active'
    });
    if (!folder) {
      return { error: 'Folder not found', status: 404 } as const;
    }
    await this.helpers.trashFolderRecursive(id, userId);
    return {
      success: true,
      message: `${folder.name} moved to trash`,
      status: 200
    } as const;
  }

  async toggleFavourite(userId: string, id: string, isFavourite: boolean) {
    if (!Types.ObjectId.isValid(id)) {
      return { error: 'Invalid folder ID', status: 400 } as const;
    }
    const folder = await this.folderModel.findOneAndUpdate(
      { _id: id, userId, status: 'active' },
      { isFavourite },
      { new: true }
    );
    if (!folder) {
      return { error: 'Folder not found', status: 404 } as const;
    }
    return { folder, status: 200 } as const;
  }
}
