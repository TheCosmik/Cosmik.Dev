import { AwsV4Signer, AwsClient } from 'aws4fetch';

const REGION = 'auto';
const SERVICE = 's3';

export function r2Configured(env) {
  return Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_NAME);
}

function endpoint(env) {
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}`;
}

function client(env) {
  return {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    region: REGION,
    service: SERVICE
  };
}

async function presignedUrl(env, { method, key, query = {}, expiresIn = 900 }) {
  const url = new URL(`${endpoint(env)}/${key}`);
  url.searchParams.set('X-Amz-Expires', String(expiresIn));
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  const signer = new AwsV4Signer({ url: url.toString(), method, signQuery: true, ...client(env) });
  const signed = await signer.sign();
  return signed.url.toString();
}

export function presignedUploadUrl(env, key, expiresIn = 900) {
  return presignedUrl(env, { method: 'PUT', key, expiresIn });
}

export function presignedPartUrl(env, key, uploadId, partNumber, expiresIn = 900) {
  return presignedUrl(env, {
    method: 'PUT',
    key,
    query: { partNumber: String(partNumber), uploadId },
    expiresIn
  });
}

export function presignedDownloadUrl(env, key, { filename, mimeType, inline = false, expiresIn = 300 } = {}) {
  const safeFilename = filename.replace(/[\r\n"]/g, '');
  const disposition = `${inline ? 'inline' : 'attachment'}; filename="${safeFilename}"`;
  return presignedUrl(env, {
    method: 'GET',
    key,
    expiresIn,
    query: {
      'response-content-disposition': disposition,
      ...(mimeType ? { 'response-content-type': mimeType } : {})
    }
  });
}

export async function createMultipartUpload(env, key) {
  const aws = new AwsClient(client(env));
  const url = `${endpoint(env)}/${key}?uploads`;
  const res = await aws.fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error(`createMultipartUpload failed: ${res.status} ${await res.text()}`);
  const xml = await res.text();
  const match = xml.match(/<UploadId>([^<]+)<\/UploadId>/);
  if (!match) throw new Error('createMultipartUpload: missing UploadId in response');
  return match[1];
}

export async function completeMultipartUpload(env, key, uploadId, parts) {
  const aws = new AwsClient(client(env));
  const url = `${endpoint(env)}/${key}?uploadId=${encodeURIComponent(uploadId)}`;
  const body = `<CompleteMultipartUpload>${parts
    .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`)
    .join('')}</CompleteMultipartUpload>`;
  const res = await aws.fetch(url, { method: 'POST', body });
  if (!res.ok) throw new Error(`completeMultipartUpload failed: ${res.status} ${await res.text()}`);
}

export async function abortMultipartUpload(env, key, uploadId) {
  const aws = new AwsClient(client(env));
  const url = `${endpoint(env)}/${key}?uploadId=${encodeURIComponent(uploadId)}`;
  const res = await aws.fetch(url, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`abortMultipartUpload failed: ${res.status} ${await res.text()}`);
}
