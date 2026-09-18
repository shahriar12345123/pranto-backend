import { S3Client } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
dotenv.config();

export const R2_CONFIG = {
  bucketName: process.env.R2_BUCKET_NAME || 'gadget-shop-images',
  endpoint: process.env.R2_ENDPOINT || 'https://0a4a69d06b422db7c733a27e8d62c0d9.r2.cloudflarestorage.com',
  publicUrl: (process.env.R2_PUBLIC_URL || 'https://pub-844c0557c33f43fb8bc62d1b17aa1e96.r2.dev').replace(/\/$/, ''),
  accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
};

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: R2_CONFIG.endpoint,
  credentials: {
    accessKeyId: R2_CONFIG.accessKeyId,
    secretAccessKey: R2_CONFIG.secretAccessKey,
  },
});
