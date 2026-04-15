import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FoldersController } from './folders.controller';
import { FoldersService } from './folders.service';
import { FoldersHelpers } from './folders.helpers';
import { Folder, FolderSchema } from '../shared/database/schemas/folder.schema';
import { File, FileSchema } from '../shared/database/schemas/file.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Folder.name, schema: FolderSchema },
      { name: File.name, schema: FileSchema },
    ]),
  ],
  controllers: [FoldersController],
  providers: [FoldersService, FoldersHelpers],
  exports: [FoldersHelpers, MongooseModule],
})
export class FoldersModule {}
