'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Copy, Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import { AuthClient } from '@/lib/auth/auth-client';
import { loadTelehealthIceConfiguration } from '@/lib/telehealth/ice-client';
import type { TelehealthSession } from '@/lib/types/ghims';

type SignalMessage = {
  messageId: string;
  type: 'OFFER' | 'ANSWER' | 'ICE' | 'LEAVE';
  payload: any;
  createdAt: number;
};

interface TelehealthCallPanelProps {
  session: TelehealthSession;
  tenantId: string;
  disabled?: boolean;
  onConnected?: () => Promise<void> | void;
}

export function TelehealthCallPanel({
  session,
  tenantId,
  disabled = false,
  onConnected,
}: TelehealthCallPanelProps) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pollRef = useRef<number | null>(null);
  const processedRef = useRef<Set<string>>(new Set());
  const lastSeenRef = useRef(0);
  const connectedReportedRef = useRef(false);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);

  const [state, setState] = useState<'IDLE' | 'PREPARING' | 'WAITING' | 'CONNECTED' | 'ENDED'>('IDLE');
  const [error, setError] = useState<string | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [copied, setCopied] = useState(false);
  const [relayAvailable, setRelayAvailable] = useState<boolean | null>(null);
  const [patientJoinToken, setPatientJoinToken] = useState<string | null>(null);

  const joinUrl =
    !patientJoinToken || typeof window === 'undefined'
      ? ''
      : `${window.location.origin}/telehealth/join?tenant=${encodeURIComponent(
          tenantId
        )}&room=${encodeURIComponent(session.roomToken)}&join=${encodeURIComponent(patientJoinToken)}`;

  const clinicianSignal = async (
    type: 'START' | 'OFFER' | 'ICE' | 'LEAVE',
    payload: unknown = null
  ) => {
    const response = await AuthClient.authorizedFetch(
      '/api/telehealth/signaling',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          roomToken: session.roomToken,
          senderRole: 'CLINICIAN',
          type,
          payload,
        }),
      },
      tenantId
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Telehealth signaling request failed.');
    }
    return data;
  };

  const loadSignals = async (): Promise<SignalMessage[]> => {
    const url =
      `/api/telehealth/signaling?tenantId=${encodeURIComponent(tenantId)}` +
      `&roomToken=${encodeURIComponent(session.roomToken)}` +
      `&receiverRole=CLINICIAN&after=${Math.max(0, lastSeenRef.current - 1)}`;
    const response = await AuthClient.authorizedFetch(url, { method: 'GET' }, tenantId);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Unable to receive telehealth signaling messages.');
    }
    return Array.isArray(data.messages) ? data.messages : [];
  };

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const disposeMedia = () => {
    stopPolling();
    peerRef.current?.close();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  };

  const processSignals = async () => {
    const peer = peerRef.current;
    if (!peer) return;
    const messages = await loadSignals();
    for (const message of messages) {
      if (!message?.messageId || processedRef.current.has(message.messageId)) continue;
      processedRef.current.add(message.messageId);
      lastSeenRef.current = Math.max(lastSeenRef.current, Number(message.createdAt || 0));

      if (message.type === 'ANSWER' && message.payload?.sdp) {
        if (!peer.currentRemoteDescription) {
          await peer.setRemoteDescription(new RTCSessionDescription(message.payload));
          for (const candidate of pendingIceRef.current.splice(0)) {
            await peer.addIceCandidate(new RTCIceCandidate(candidate));
          }
        }
      } else if (message.type === 'ICE' && message.payload) {
        if (!peer.currentRemoteDescription) {
          pendingIceRef.current.push(message.payload as RTCIceCandidateInit);
        } else {
          await peer.addIceCandidate(new RTCIceCandidate(message.payload));
        }
      } else if (message.type === 'LEAVE') {
        setState('ENDED');
        disposeMedia();
      }
    }
  };

  const startCall = async () => {
    if (disabled || state === 'PREPARING' || state === 'WAITING' || state === 'CONNECTED') return;
    setError(null);
    setPatientJoinToken(null);
    setState('PREPARING');
    connectedReportedRef.current = false;
    processedRef.current.clear();
    pendingIceRef.current = [];
    lastSeenRef.current = 0;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('This browser does not provide camera/microphone access required for telehealth.');
      }

      const startedRoom = await clinicianSignal('START');
      if (typeof startedRoom.patientJoinToken !== 'string' || !startedRoom.patientJoinToken) {
        throw new Error('The server did not issue a patient-specific join capability.');
      }
      setPatientJoinToken(startedRoom.patientJoinToken);
      const ice = await loadTelehealthIceConfiguration({
        tenantId, roomToken: session.roomToken, role: 'CLINICIAN',
      });
      setRelayAvailable(ice.relayConfigured);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      streamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const peer = new RTCPeerConnection({ iceServers: ice.iceServers });
      peerRef.current = peer;
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));

      peer.ontrack = (event) => {
        const remote = event.streams[0];
        if (remote && remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remote;
        }
      };
      peer.onicecandidate = (event) => {
        if (event.candidate) {
          void clinicianSignal('ICE', event.candidate.toJSON()).catch((cause) => {
            setError(cause instanceof Error ? cause.message : 'ICE candidate relay failed.');
          });
        }
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') {
          setState('CONNECTED');
          if (!connectedReportedRef.current) {
            connectedReportedRef.current = true;
            void Promise.resolve(onConnected?.());
          }
        } else if (['failed', 'disconnected'].includes(peer.connectionState)) {
          setError('Media connection was interrupted. You can end and restart the call without losing the clinical encounter.');
        }
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await clinicianSignal('OFFER', {
        type: offer.type,
        sdp: offer.sdp,
      });

      setState('WAITING');
      await processSignals();
      pollRef.current = window.setInterval(() => {
        void processSignals().catch((cause) => {
          setError(cause instanceof Error ? cause.message : 'Telehealth signaling failed.');
        });
      }, 1000);
    } catch (cause) {
      disposeMedia();
      setState('IDLE');
      setError(cause instanceof Error ? cause.message : 'Unable to start the telehealth call.');
    }
  };

  const endCall = async () => {
    try {
      await clinicianSignal('LEAVE');
    } catch {
      // Local media must still terminate if the signaling endpoint is unavailable.
    } finally {
      disposeMedia();
      setPatientJoinToken(null);
      setState('ENDED');
    }
  };

  const toggleMic = () => {
    const next = !micEnabled;
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
    setMicEnabled(next);
  };

  const toggleVideo = () => {
    const next = !videoEnabled;
    streamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    setVideoEnabled(next);
  };

  useEffect(() => {
    return () => {
      disposeMedia();
    };
  }, []);

  return (
    <div className="space-y-3 rounded-xl border border-teal-200 bg-teal-50/40 p-4 dark:border-teal-900 dark:bg-teal-950/20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-black text-slate-900 dark:text-slate-100">
            Secure patient call
          </h3>
          <p className="mt-1 text-[11px] text-slate-500">
            Browser WebRTC media with G-HIMS server-governed signaling. Share the private join link only with this patient.
          </p>
        </div>
        <span className="rounded-full border px-2 py-1 text-[10px] font-bold">
          {state}
        </span>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
          {error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="relative min-h-48 overflow-hidden rounded-xl bg-slate-950">
          <video ref={remoteVideoRef} autoPlay playsInline className="h-full min-h-48 w-full object-cover" />
          <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[10px] font-bold text-white">
            Patient
          </span>
        </div>
        <div className="relative min-h-48 overflow-hidden rounded-xl bg-slate-900">
          <video ref={localVideoRef} autoPlay playsInline muted className="h-full min-h-48 w-full object-cover" />
          <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[10px] font-bold text-white">
            Clinician
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {state !== 'WAITING' && state !== 'CONNECTED' ? (
          <button
            type="button"
            data-testid="telehealth-start-call"
            disabled={disabled || state === 'PREPARING'}
            onClick={() => void startCall()}
            className="rounded-lg bg-teal-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            <Video className="mr-1 inline h-4 w-4" />
            {state === 'PREPARING' ? 'Starting secure call…' : 'Start secure video call'}
          </button>
        ) : (
          <>
            <button type="button" onClick={toggleMic} className="rounded-lg border bg-white px-3 py-2 text-xs font-bold dark:bg-slate-900">
              {micEnabled ? <Mic className="mr-1 inline h-4 w-4" /> : <MicOff className="mr-1 inline h-4 w-4" />}
              {micEnabled ? 'Mute' : 'Unmute'}
            </button>
            <button type="button" onClick={toggleVideo} className="rounded-lg border bg-white px-3 py-2 text-xs font-bold dark:bg-slate-900">
              {videoEnabled ? <Video className="mr-1 inline h-4 w-4" /> : <VideoOff className="mr-1 inline h-4 w-4" />}
              {videoEnabled ? 'Camera off' : 'Camera on'}
            </button>
            <button type="button" onClick={() => void endCall()} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold text-white">
              <PhoneOff className="mr-1 inline h-4 w-4" />
              End call
            </button>
          </>
        )}
      </div>

      {joinUrl && (
        <div className="flex flex-col gap-2 rounded-lg border bg-white p-3 dark:bg-slate-900 sm:flex-row sm:items-center">
          <input
            readOnly
            aria-label="Patient telehealth join link"
            value={joinUrl}
            className="min-w-0 flex-1 bg-transparent text-[11px] text-slate-600 outline-none dark:text-slate-300"
          />
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(joinUrl);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
            className="rounded-lg border px-3 py-2 text-xs font-bold"
          >
            <Copy className="mr-1 inline h-3.5 w-3.5" />
            {copied ? 'Copied' : 'Copy patient join link'}
          </button>
        </div>
      )}

      {relayAvailable === false && (
        <p role="status" className="text-[11px] text-amber-700 dark:text-amber-300">
          Institution-approved TURN relay is not configured. Hospital firewall and
          mobile-network calls may fail until IT provisions the relay.
        </p>
      )}
    </div>
  );
}
