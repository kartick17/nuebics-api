import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TrashController } from './trash.controller';
import { TrashService } from './trash.service';
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
  controllers: [TrashController],
  providers: [TrashService],
})
export class TrashModule {}
