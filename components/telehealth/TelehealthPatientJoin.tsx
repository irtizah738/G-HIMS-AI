'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, ShieldCheck, Video, VideoOff } from 'lucide-react';

type SignalMessage = {
  messageId: string;
  type: 'OFFER' | 'ANSWER' | 'ICE' | 'LEAVE';
  payload: any;
  createdAt: number;
};

function iceServers(): RTCIceServer[] {
  const raw = String(process.env.NEXT_PUBLIC_GHIMS_WEBRTC_ICE_SERVERS_JSON || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function TelehealthPatientJoin({
  tenantId,
  roomToken,
}: {
  tenantId: string;
  roomToken: string;
}) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pollRef = useRef<number | null>(null);
  const processedRef = useRef<Set<string>>(new Set());
  const lastSeenRef = useRef(0);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);

  const [state, setState] = useState<'READY' | 'JOINING' | 'WAITING' | 'CONNECTED' | 'ENDED'>('READY');
  const [error, setError] = useState<string | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);

  const patientSignal = async (
    type: 'ANSWER' | 'ICE' | 'LEAVE',
    payload: unknown = null
  ) => {
    const response = await fetch('/api/telehealth/signaling', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId,
        roomToken,
        senderRole: 'PATIENT',
        type,
        payload,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to send call signaling data.');
    return data;
  };

  const loadSignals = async (): Promise<SignalMessage[]> => {
    const url =
      `/api/telehealth/signaling?tenantId=${encodeURIComponent(tenantId)}` +
      `&roomToken=${encodeURIComponent(roomToken)}` +
      `&receiverRole=PATIENT&after=${Math.max(0, lastSeenRef.current - 1)}`;
    const response = await fetch(url, { method: 'GET', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to receive call signaling data.');
    return Array.isArray(data.messages) ? data.messages : [];
  };

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const dispose = () => {
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

      if (message.type === 'OFFER' && message.payload?.sdp) {
        if (!peer.currentRemoteDescription) {
          await peer.setRemoteDescription(new RTCSessionDescription(message.payload));
          for (const candidate of pendingIceRef.current.splice(0)) {
            await peer.addIceCandidate(new RTCIceCandidate(candidate));
          }
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          await patientSignal('ANSWER', {
            type: answer.type,
            sdp: answer.sdp,
          });
        }
      } else if (message.type === 'ICE' && message.payload) {
        if (!peer.currentRemoteDescription) {
          pendingIceRef.current.push(message.payload as RTCIceCandidateInit);
        } else {
          await peer.addIceCandidate(new RTCIceCandidate(message.payload));
        }
      } else if (message.type === 'LEAVE') {
        setState('ENDED');
        dispose();
      }
    }
  };

  const join = async () => {
    if (state === 'JOINING' || state === 'WAITING' || state === 'CONNECTED') return;
    setState('JOINING');
    setError(null);
    processedRef.current.clear();
    pendingIceRef.current = [];
    lastSeenRef.current = 0;

    try {
      if (!tenantId || !roomToken) throw new Error('Telehealth join link is incomplete.');
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('This browser does not support camera/microphone access.');
      }

      // Verify the clinician has activated the room before requesting media.
      await loadSignals();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      streamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const peer = new RTCPeerConnection({ iceServers: iceServers() });
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
          void patientSignal('ICE', event.candidate.toJSON()).catch((cause) => {
            setError(cause instanceof Error ? cause.message : 'Media negotiation failed.');
          });
        }
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') {
          setState('CONNECTED');
        } else if (['failed', 'disconnected'].includes(peer.connectionState)) {
          setError('The media connection was interrupted. Rejoin the visit if needed.');
        }
      };

      setState('WAITING');
      await processSignals();
      pollRef.current = window.setInterval(() => {
        void processSignals().catch((cause) => {
          setError(cause instanceof Error ? cause.message : 'Telehealth signaling failed.');
        });
      }, 1000);
    } catch (cause) {
      dispose();
      setState('READY');
      setError(cause instanceof Error ? cause.message : 'Unable to join the telehealth call.');
    }
  };

  const leave = async () => {
    try {
      await patientSignal('LEAVE');
    } catch {
      // Always release local camera/microphone even if signaling is unavailable.
    } finally {
      dispose();
      setState('ENDED');
    }
  };

  useEffect(() => () => dispose(), []);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
      <div className="rounded-2xl border border-teal-200 bg-white p-5 shadow-sm dark:border-teal-900 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-teal-600" />
          <h1 className="text-lg font-black">G-HIMS Telehealth Visit</h1>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          This private visit link connects your browser directly to the clinical team. Do not forward it.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="relative min-h-64 overflow-hidden rounded-2xl bg-slate-950">
          <video ref={remoteVideoRef} autoPlay playsInline className="h-full min-h-64 w-full object-cover" />
          <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs font-bold text-white">
            Clinical team
          </span>
        </div>
        <div className="relative min-h-64 overflow-hidden rounded-2xl bg-slate-900">
          <video ref={localVideoRef} autoPlay playsInline muted className="h-full min-h-64 w-full object-cover" />
          <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs font-bold text-white">
            You
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {!['WAITING', 'CONNECTED'].includes(state) ? (
          <button
            type="button"
            data-testid="telehealth-patient-join"
            onClick={() => void join()}
            disabled={state === 'JOINING' || state === 'ENDED'}
            className="rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            <Video className="mr-1 inline h-4 w-4" />
            {state === 'JOINING' ? 'Joining…' : state === 'ENDED' ? 'Visit ended' : 'Join video visit'}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                const next = !micEnabled;
                streamRef.current?.getAudioTracks().forEach((track) => (track.enabled = next));
                setMicEnabled(next);
              }}
              className="rounded-xl border bg-white px-4 py-2.5 text-sm font-bold dark:bg-slate-900"
            >
              {micEnabled ? <Mic className="mr-1 inline h-4 w-4" /> : <MicOff className="mr-1 inline h-4 w-4" />}
              {micEnabled ? 'Mute' : 'Unmute'}
            </button>
            <button
              type="button"
              onClick={() => {
                const next = !videoEnabled;
                streamRef.current?.getVideoTracks().forEach((track) => (track.enabled = next));
                setVideoEnabled(next);
              }}
              className="rounded-xl border bg-white px-4 py-2.5 text-sm font-bold dark:bg-slate-900"
            >
              {videoEnabled ? <Video className="mr-1 inline h-4 w-4" /> : <VideoOff className="mr-1 inline h-4 w-4" />}
              {videoEnabled ? 'Camera off' : 'Camera on'}
            </button>
            <button
              type="button"
              onClick={() => void leave()}
              className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white"
            >
              <PhoneOff className="mr-1 inline h-4 w-4" />
              Leave call
            </button>
          </>
        )}
      </div>
    </div>
  );
}
