import { useState, useEffect, useCallback, useRef } from 'react';
import { SignalingService } from '../services/signaling.service';
import { WebRtcService } from '../services/webrtc.service';
import { Role, RoomState, Peer } from '@shared/types';

export function useRoom() {
  const [roomId, setRoomId] = useState('');
  const [peerId, setPeerId] = useState('');
  const [role, setRole] = useState<Role | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, { stream: MediaStream; peer: Peer }>>(new Map());
  const [previousSpeakerStream, setPreviousSpeakerStream] = useState<{ stream: MediaStream; peer: Peer } | null>(null);
  const [isSwitchingSpeaker, setIsSwitchingSpeaker] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magnification, setMagnification] = useState(100);
  const [scaleBarLength, setScaleBarLength] = useState(0.2);
  const [scaleUnit, setScaleUnit] = useState('μm');

  const signalingRef = useRef<SignalingService | null>(null);
  const webrtcRef = useRef<WebRtcService | null>(null);
  const producerIdsRef = useRef<{ video?: string; audio?: string }>({});

  const initServices = useCallback(() => {
    if (!signalingRef.current) {
      signalingRef.current = new SignalingService();
    }
    if (!webrtcRef.current) {
      webrtcRef.current = new WebRtcService(signalingRef.current);
    }
  }, []);

  const joinRoom = useCallback(async (room: string, name: string, userRole: Role) => {
    try {
      initServices();
      setError(null);

      await signalingRef.current!.connect();

      const result = await signalingRef.current!.joinRoom(room, name, userRole);
      setRoomId(room);
      setPeerId(result.peerId);
      setRole(userRole);
      setRoomState(result.roomState);
      setIsConnected(true);

      await webrtcRef.current!.initialize();
      await webrtcRef.current!.createRecvTransport();

      setupSignalingListeners();

      if (userRole === 'speaker') {
        await startPublishing();
      } else {
          const speakers = result.roomState.peers.filter(p => p.role === 'speaker');
          for (const speaker of speakers) {
            if (speaker.id !== result.peerId) {
              await consumeSpeaker(speaker.id);
            }
          }
        }

      try {
        const magData = await signalingRef.current!.getMagnification();
        if (magData && !magData.error) {
          setMagnification(magData.magnification);
          setScaleBarLength(magData.scaleBarLength);
          setScaleUnit(magData.unit);
        }
      } catch (err) {
        console.warn('Failed to get initial magnification:', err);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join room');
      throw err;
    }
  }, [initServices]);

  const setupSignalingListeners = useCallback(() => {
    const signaling = signalingRef.current;
    if (!signaling) return;

    signaling.on('peer-joined', async (data: { peerId: string; role: Role; name: string; roomState: RoomState }) => {
      setRoomState(data.roomState);
      if (data.role === 'speaker' && role === 'viewer') {
        await consumeSpeaker(data.peerId);
      }
    });

    signaling.on('peer-left', (data: { peerId: string; roomState: RoomState }) => {
      setRoomState(data.roomState);

      const leavingPeer = roomState?.peers.find(p => p.id === data.peerId);
      const isLeavingSpeaker = leavingPeer?.role === 'speaker';

      if (isLeavingSpeaker) {
        setRemoteStreams(prev => {
          const leavingStream = prev.get(data.peerId);
          if (leavingStream) {
            setPreviousSpeakerStream(leavingStream);
            setIsSwitchingSpeaker(true);

            setTimeout(() => {
              setPreviousSpeakerStream(null);
              setIsSwitchingSpeaker(false);
            }, 5000);
          }

          const next = new Map(prev);
          next.delete(data.peerId);
          return next;
        });
      } else {
        setRemoteStreams(prev => {
          const next = new Map(prev);
          next.delete(data.peerId);
          return next;
        });
      }
    });

    signaling.on('new-producer', async (data: { producerId: string; kind: 'audio' | 'video'; peerId: string }) => {
      if (role === 'viewer') {
        await consumeProducer(data.producerId, data.peerId, data.kind);
      }
    });

    signaling.on('magnification-updated', (data: { magnification: number; scaleBarLength: number; unit: string }) => {
      setMagnification(data.magnification);
      setScaleBarLength(data.scaleBarLength);
      setScaleUnit(data.unit);
    });
  }, [role]);

  const startPublishing = useCallback(async () => {
    try {
      if (!webrtcRef.current) return;

      await webrtcRef.current.createSendTransport();

      const stream = await webrtcRef.current.getLocalStream();
      setLocalStream(stream);

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      if (videoTrack) {
        const videoProducer = await webrtcRef.current.produceVideo(videoTrack);
        producerIdsRef.current.video = videoProducer.id;
      }

      if (audioTrack) {
        const audioProducer = await webrtcRef.current.produceAudio(audioTrack);
        producerIdsRef.current.audio = audioProducer.id;
      }

      setIsPublishing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start publishing');
    }
  }, []);

  const pendingProducersRef = useRef<Map<string, { producerId: string; kind: 'audio' | 'video' }[]>>(new Map());
  const debounceTimerRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const consumeProducersSync = useCallback(async (peerId: string) => {
    try {
      if (!webrtcRef.current || !signalingRef.current) return;

      const pending = pendingProducersRef.current.get(peerId);
      if (!pending || pending.length === 0) return;

      pendingProducersRef.current.delete(peerId);

      const producerIds = pending.map(p => p.producerId);
      const consumers = await webrtcRef.current.consumeMany(producerIds);

      if (consumers.size === 0) return;

      const tracks: MediaStreamTrack[] = [];
      const consumerIds: string[] = [];

      consumers.forEach((consumer) => {
        tracks.push(consumer.track);
        consumerIds.push(consumer.id);
      });

      const peer = roomState?.peers.find(p => p.id === peerId);
      if (!peer) return;

      const stream = new MediaStream(tracks);

      await webrtcRef.current.resumeConsumers(consumerIds);

      setRemoteStreams(prev => {
        const next = new Map(prev);
        const existing = next.get(peerId);

        if (existing) {
          tracks.forEach(track => {
            try {
              existing.stream.removeTrack(existing.stream.getTrackById(track.id));
            } catch {}
            existing.stream.addTrack(track);
          });
          next.set(peerId, existing);
        } else {
          next.set(peerId, { stream, peer });
        }
        return next;
      });

      const peerData = roomState?.peers.find(p => p.id === peerId);
      if (peerData?.role === 'speaker') {
        setPreviousSpeakerStream(null);
        setIsSwitchingSpeaker(false);
      }
    } catch (err) {
      console.error('Failed to consume producers sync:', err);
    }
  }, [roomState]);

  const queueProducer = useCallback((producerId: string, peerId: string, kind: 'audio' | 'video') => {
    if (!pendingProducersRef.current.has(peerId)) {
      pendingProducersRef.current.set(peerId, []);
    }

    const queue = pendingProducersRef.current.get(peerId)!;
    queue.push({ producerId, kind });

    if (debounceTimerRef.current.has(peerId)) {
      clearTimeout(debounceTimerRef.current.get(peerId)!);
    }

    debounceTimerRef.current.set(peerId, setTimeout(() => {
      consumeProducersSync(peerId);
    }, 50));
  }, [consumeProducersSync]);

  const consumeProducer = useCallback(async (producerId: string, peerId: string, kind: 'audio' | 'video') => {
    queueProducer(producerId, peerId, kind);
  }, [queueProducer]);

  const consumeSpeaker = useCallback(async (speakerId: string) => {
    try {
      const speakers = await signalingRef.current?.getActiveSpeakers();
      if (!speakers) return;

      const producers = speakers;

      if (producers.length === 0) return;

      if (producers.length >= 2) {
        const producerIds = producers.map(p => p.id);
        const consumers = await webrtcRef.current?.consumeMany(producerIds);
        if (!consumers || consumers.size === 0) return;

        const tracks: MediaStreamTrack[] = [];
        const consumerIds: string[] = [];

        consumers.forEach((consumer) => {
          tracks.push(consumer.track);
          consumerIds.push(consumer.id);
        });

        const peer = roomState?.peers.find(p => p.id === speakerId);
        if (!peer) return;

        const stream = new MediaStream(tracks);

        await webrtcRef.current?.resumeConsumers(consumerIds);

        setRemoteStreams(prev => {
          const next = new Map(prev);
          next.set(speakerId, { stream, peer });
          return next;
        });

        setPreviousSpeakerStream(null);
        setIsSwitchingSpeaker(false);
      } else {
        for (const producer of producers) {
          queueProducer(producer.id, speakerId, producer.kind);
        }
      }
    } catch (err) {
      console.error('Failed to consume speaker:', err);
    }
  }, [roomState, queueProducer]);

  const updateMagnification = useCallback(async (newMagnification: number) => {
    if (!signalingRef.current) return;
    try {
      await signalingRef.current.setMagnification(newMagnification);
    } catch (err) {
      console.error('Failed to update magnification:', err);
    }
  }, []);

  const leaveRoom = useCallback(() => {
    try {
      debounceTimerRef.current.forEach((timer) => clearTimeout(timer));
      debounceTimerRef.current.clear();
      pendingProducersRef.current.clear();

      webrtcRef.current?.close();
      signalingRef.current?.leaveRoom();
      signalingRef.current?.disconnect();

      signalingRef.current = null;
      webrtcRef.current = null;

      setRoomId('');
      setPeerId('');
      setRole(null);
      setRoomState(null);
      setLocalStream(null);
      setRemoteStreams(new Map());
      setIsConnected(false);
      setIsPublishing(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to leave room');
    }
  }, []);

  useEffect(() => {
    return () => {
      leaveRoom();
    };
  }, [leaveRoom]);

  return {
    roomId,
    peerId,
    role,
    roomState,
    localStream,
    remoteStreams,
    previousSpeakerStream,
    isSwitchingSpeaker,
    isConnected,
    isPublishing,
    error,
    magnification,
    scaleBarLength,
    scaleUnit,
    joinRoom,
    leaveRoom,
    startPublishing,
    updateMagnification,
  };
}
