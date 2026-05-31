const MinIO = require('minio');

const minioClient = new MinIO.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT, 10) || 9000,
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin'
});

const BUCKET_NAME = process.env.MINIO_BUCKET || 'molecule-files';

async function initBucket() {
  try {
    const exists = await minioClient.bucketExists(BUCKET_NAME);
    if (!exists) {
      await minioClient.makeBucket(BUCKET_NAME, 'us-east-1');
      console.log(`Bucket ${BUCKET_NAME} created successfully`);
    }
  } catch (error) {
    console.error('Error initializing MinIO bucket:', error);
  }
}

async function uploadFile(fileName, buffer, contentType) {
  await minioClient.putObject(BUCKET_NAME, fileName, buffer, {
    'Content-Type': contentType
  });
  return fileName;
}

async function getFile(fileName) {
  const stream = await minioClient.getObject(BUCKET_NAME, fileName);
  return stream;
}

async function getFileAsString(fileName) {
  const stream = await getFile(fileName);
  return new Promise((resolve, reject) => {
    let content = '';
    stream.on('data', (chunk) => {
      content += chunk.toString();
    });
    stream.on('end', () => {
      resolve(content);
    });
    stream.on('error', reject);
  });
}

module.exports = {
  minioClient,
  initBucket,
  uploadFile,
  getFile,
  getFileAsString
};
