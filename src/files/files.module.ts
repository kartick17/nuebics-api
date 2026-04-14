import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { DownloadController } from './download.controller';
import { ContentsController } from './contents.controller';
import { File, FileSchema } from '../shared/database/schemas/file.schema';
import { Folder, FolderSchema } from '../shared/database/schemas/folder.schema';
import { FoldersModule } from '../folders/folders.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: File.name, schema: FileSchema },
      { name: Folder.name, schema: FolderSchema },
    ]),
    FoldersModule,
  ],
  controllers: [FilesController, DownloadController, ContentsController],
  providers: [FilesService],
  exports: [FilesService, MongooseModule],
})
export class FilesModule {}
