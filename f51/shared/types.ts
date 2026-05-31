export type Role = 'speaker' | 'viewer';

export interface Peer {
  id: string;
  name: string;
  role: Role;
}

export interface RoomState {
  roomId: string;
  peers: Peer[];
  activeSpeakerId: string | null;
}

export interface SignalingMessage {
  type: string;
  payload: any;
}

export interface WebRtcTransportOptions {
  id: string;
  iceParameters: any;
  iceCandidates: any[];
  dtlsParameters: any;
  sctpParameters?: any;
}

export interface RtpCapabilities {
  codecs: any[];
  headerExtensions?: any[];
}

export interface ProducerOptions {
  id: string;
  kind: 'audio' | 'video';
  rtpParameters: any;
  appData?: any;
}

export interface ConsumerOptions {
  id: string;
  producerId: string;
  kind: 'audio' | 'video';
  rtpParameters: any;
  appData?: any;
}

export interface DepthFrameData {
  depthMap: Float32Array;
  width: number;
  height: number;
  timestamp: number;
}

export interface MagnificationUpdate {
  roomId: string;
  magnification: number;
  unit: string;
  scaleBarLength: number;
}

export const MEDIASOUP_CONFIG = {
  codecs: [
    {
      kind: 'video',
      mimeType: 'video/H264',
      clockRate: 90000,
      parameters: {
        'packetization-mode': 1,
        'profile-level-id': '42e01f',
        'level-asymmetry-allowed': 1
      },
      rtcpFeedback: [
        { type: 'nack' },
        { type: 'nack', parameter: 'pli' },
        { type: 'ccm', parameter: 'fir' },
        { type: 'goog-remb' },
        { type: 'transport-cc' }
      ]
    },
    {
      kind: 'audio',
      mimeType: 'audio/opus',
      clockRate: 48000,
      channels: 2
    }
  ]
};
