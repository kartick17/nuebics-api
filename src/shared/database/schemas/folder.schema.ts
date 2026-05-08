import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FolderDocument = HydratedDocument<Folder>;

@Schema({ timestamps: true, collection: 'folders' })
export class Folder {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, trim: true, maxlength: 255 })
  name: string;

  @Prop({ type: Types.ObjectId, ref: 'Folder', default: null, index: true })
  parentId: Types.ObjectId | null;

  @Prop({ default: false, index: true })
  isFavourite: boolean;

  @Prop({
    type: String,
    enum: ['active', 'trashed'],
    default: 'active',
    index: true
  })
  status: 'active' | 'trashed';

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const FolderSchema = SchemaFactory.createForClass(Folder);
FolderSchema.index({ userId: 1, parentId: 1, status: 1 });
FolderSchema.index({ userId: 1, parentId: 1, name: 1 }, { unique: true });
FolderSchema.index({ userId: 1, isFavourite: 1, status: 1 });
