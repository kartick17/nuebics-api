import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
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
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService, MongooseModule],
})
export class FilesModule {}
