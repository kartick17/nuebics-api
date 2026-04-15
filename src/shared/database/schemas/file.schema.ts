import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FileDocument = HydratedDocument<File>;

@Schema({ timestamps: true, collection: 'files' })
export class File {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  key: string;

  @Prop({ required: true })
  size: number;

  @Prop({ required: true })
  type: string;

  @Prop({ type: Types.ObjectId, ref: 'Folder', default: null, index: true })
  folderId: Types.ObjectId | null;

  @Prop({ default: false, index: true })
  isFavourite: boolean;

  @Prop({ type: String, enum: ['active', 'trashed'], default: 'active', index: true })
  status: 'active' | 'trashed';

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const FileSchema = SchemaFactory.createForClass(File);
FileSchema.index({ userId: 1, folderId: 1, status: 1 });
FileSchema.index({ userId: 1, isFavourite: 1, status: 1 });
