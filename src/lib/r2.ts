export async function uploadToR2(
  imageBase64: string,
  walkId: string,
  elapsedSec: number
): Promise<string | null> {
  const uploadTimeoutMs = 5_000;
  const accountId = process.env.CF_ACCOUNT_ID;
  const accessKeyId = process.env.CF_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CF_SECRET_ACCESS_KEY;
  const bucketName = process.env.CF_R2_BUCKET_NAME;
  const publicUrl = process.env.CF_R2_PUBLIC_URL;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName || !publicUrl) {
    return null;
  }

  try {
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const key = `walks/${walkId}/${elapsedSec}.jpg`;
    const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;

    const url = `${endpoint}/${bucketName}/${key}`;
    const now = new Date();

    const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
    const amzDate = now.toISOString().replace(/[:-]/g, '').slice(0, 15) + 'Z';
    const region = 'auto';
    const service = 's3';

    const canonicalHeaders =
      `content-type:image/jpeg\n` +
      `host:${accountId}.r2.cloudflarestorage.com\n` +
      `x-amz-content-sha256:${await sha256Hex(imageBuffer)}\n` +
      `x-amz-date:${amzDate}\n`;

    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
    const payloadHash = await sha256Hex(imageBuffer);

    const canonicalRequest = [
      'PUT',
      `/${bucketName}/${key}`,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      await sha256Hex(Buffer.from(canonicalRequest)),
    ].join('\n');

    const signingKey = await getSigningKey(secretAccessKey, dateStamp, region, service);
    const signature = await hmacHex(signingKey, stringToSign);

    const authHeader =
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'image/jpeg',
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
        Authorization: authHeader,
      },
      body: imageBuffer,
      signal: AbortSignal.timeout(uploadTimeoutMs),
    });

    if (!res.ok) return null;

    return `${publicUrl}/${key}`;
  } catch {
    return null;
  }
}

async function sha256Hex(data: Buffer | string): Promise<string> {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(buf));
  return Buffer.from(hash).toString('hex');
}

async function hmacHex(key: ArrayBuffer, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  return Buffer.from(sig).toString('hex');
}

async function hmacRaw(key: ArrayBuffer | Buffer, data: string): Promise<ArrayBuffer> {
  const rawKey: ArrayBuffer = key instanceof Buffer
    ? new Uint8Array(key).buffer as ArrayBuffer
    : key as ArrayBuffer;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}

async function getSigningKey(
  secret: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<ArrayBuffer> {
  const kDate = await hmacRaw(Buffer.from(`AWS4${secret}`), dateStamp);
  const kRegion = await hmacRaw(kDate, region);
  const kService = await hmacRaw(kRegion, service);
  return hmacRaw(kService, 'aws4_request');
}
