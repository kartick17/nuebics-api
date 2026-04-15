import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

jest.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: jest.fn().mockResolvedValue("https://mock-s3.example/presigned"),
}));

export const s3Mock = mockClient(S3Client);

export function resetS3Mock() {
  s3Mock.reset();
  s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 100 });
  s3Mock.on(PutObjectCommand).resolves({});
  s3Mock.on(GetObjectCommand).resolves({});
  s3Mock.on(DeleteObjectCommand).resolves({});
  (getSignedUrl as jest.Mock).mockResolvedValue("https://mock-s3.example/presigned");
}

export function s3HeadMissing() {
  s3Mock.on(HeadObjectCommand).rejects(new Error("NotFound"));
}

export function s3HeadSize(size: number) {
  s3Mock.on(HeadObjectCommand).resolves({ ContentLength: size });
}
