const Koa = require('koa');
const cors = require('@koa/cors');
const { koaBody } = require('koa-body');
const router = require('./routes');
const { initBucket } = require('./config/minio');

const app = new Koa();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(koaBody({
  multipart: true,
  formidable: {
    maxFileSize: 50 * 1024 * 1024
  }
}));

app.use(router.routes());
app.use(router.allowedMethods());

async function startServer() {
  await initBucket();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
