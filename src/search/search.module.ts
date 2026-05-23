import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { File, FileSchema } from '../shared/database/schemas/file.schema';
import {
  Folder,
  FolderSchema
} from '../shared/database/schemas/folder.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: File.name, schema: FileSchema },
      { name: Folder.name, schema: FolderSchema }
    ])
  ],
  controllers: [SearchController],
  providers: [SearchService]
})
export class SearchModule {}
