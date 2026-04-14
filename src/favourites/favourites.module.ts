import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FavouritesController } from './favourites.controller';
import { FavouritesService } from './favourites.service';
import { File, FileSchema } from '../shared/database/schemas/file.schema';
import { Folder, FolderSchema } from '../shared/database/schemas/folder.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: File.name, schema: FileSchema },
      { name: Folder.name, schema: FolderSchema },
    ]),
  ],
  controllers: [FavouritesController],
  providers: [FavouritesService],
})
export class FavouritesModule {}
