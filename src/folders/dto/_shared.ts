import { z } from 'zod';

const INVALID_CHARS = /[/\\:*?"<>|]/;
const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i;

export const folderNameSchema = z
  .string()
  .trim()
  .min(1, 'Folder name is required')
  .max(255, 'Folder name must be 255 characters or fewer')
  .refine((v) => !INVALID_CHARS.test(v), {
    message: 'Folder name cannot contain / \\ : * ? " < > |'
  })
  .refine((v) => !RESERVED_NAMES.test(v), {
    message: 'This name is reserved by the system'
  });

export const fileNameSchema = z
  .string()
  .trim()
  .min(1, 'File name is required')
  .max(255, 'File name must be 255 characters or fewer')
  .refine((v) => !INVALID_CHARS.test(v), {
    message: 'File name cannot contain / \\ : * ? " < > |'
  })
  .refine((v) => !RESERVED_NAMES.test(v), {
    message: 'This name is reserved by the system'
  });
