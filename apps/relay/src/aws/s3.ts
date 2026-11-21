import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Files } from '../ports'

export function createS3Files(bucket: string, client = new S3Client({})): Files {
  return {
    async put(key, data, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: data,
          ContentType: contentType,
          ServerSideEncryption: 'AES256',
        }),
      )
    },
    presignGet: (key, expiresInSec) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: expiresInSec,
      }),
    async deleteAll() {
      let n = 0
      let token: string | undefined
      do {
        const list = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: 'media/', ContinuationToken: token }),
        )
        const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key! }))
        if (keys.length) {
          await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }))
          n += keys.length
        }
        token = list.NextContinuationToken
      } while (token)
      return n
    },
  }
}
