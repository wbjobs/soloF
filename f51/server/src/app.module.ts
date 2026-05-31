import { Module } from '@nestjs/common';
import { MediasoupService } from './services/mediasoup.service';
import { RoomService } from './services/room.service';
import { SignalingGateway } from './gateways/signaling.gateway';

@Module({
  providers: [MediasoupService, RoomService, SignalingGateway],
})
export class AppModule {}
