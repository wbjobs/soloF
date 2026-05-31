import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as cors from 'cors';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.use(cors({ origin: '*' }));

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`Signaling server running on http://localhost:${port}`);
}

bootstrap();
