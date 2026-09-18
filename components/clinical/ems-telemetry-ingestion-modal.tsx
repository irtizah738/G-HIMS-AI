'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Ambulance,
  Radio,
  Activity,
  Heart,
  ShieldAlert,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Volume2,
  VolumeX,
  Send,
  X,
  Sparkles,
  Bed,
  PhoneCall,
  Flame,
  ArrowRight,
} from 'lucide-react';

export interface InboundTelemetryData {
  id: string;
  unit: string;
  patientName: string;
  age: number;
  gender: string;
  etaSeconds: number;
  chiefComplaint: string;
  crewLeader: string;
  vitals: {
    hr: number;
    bp: string;
    spo2: number;
    gcs: number;
    etco2: number;
    tempC: number;
  };
  ecgFinding: string;
  ecgStatus: 'STEMI' | 'VTAC' | 'SINUS_TACH' | 'NORMAL';
  radioChannel: string;
  preparedBay: string;
  codeAlert?: 'STEMI' | 'STROKE' | 'TRAUMA_ALPHA' | 'CODE_BLUE';
  mechanism?: string;
  intercomLog: Array<{ sender: string; time: string; message: string }>;
}

interface EMSTelemetryIngestionModalProps {
  telemetry: InboundTelemetryData;
  isOpen: boolean;
  onClose: () => void;
  onDirectIntake: (telemetry: InboundTelemetryData) => void;
}

export function EMSTelemetryIngestionModal({
  telemetry,
  isOpen,
  onClose,
  onDirectIntake,
}: EMSTelemetryIngestionModalProps) {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(telemetry.etaSeconds);
  const [isRadioMuted, setIsRadioMuted] = useState<boolean>(false);
  const [intercomMessages, setIntercomMessages] = useState(telemetry.intercomLog);
  const [newPhysicianMessage, setNewPhysicianMessage] = useState<string>('');
  const [isAdmitting, setIsAdmitting] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Countdown timer
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      setSecondsRemaining((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // Live ECG Monitor Waveform Sweep
  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let x = 0;
    const width = canvas.width;
    const height = canvas.height;
    const midY = height / 2;

    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 0.5;
    for (let gx = 0; gx < width; gx += 20) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, height);
      ctx.stroke();
    }
    for (let gy = 0; gy < height; gy += 20) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(width, gy);
      ctx.stroke();
    }

    let beatPhase = 0;

    const render = () => {
      // Clear trailing beam head
      ctx.fillStyle = 'rgba(9, 13, 22, 0.08)';
      ctx.fillRect(x, 0, 16, height);

      ctx.beginPath();
      ctx.strokeStyle = '#10b981'; // Phosphor green ECG
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.moveTo(x, midY);

      // Generate ECG QRS complex shape
      let dy = 0;
      beatPhase = (beatPhase + 1) % 55;

      if (beatPhase === 15) {
        dy = -6; // P wave
      } else if (beatPhase === 20) {
        dy = 4; // Q dip
      } else if (beatPhase === 22) {
        dy = -48; // R spike
      } else if (beatPhase === 24) {
        dy = 18; // S dip
      } else if (beatPhase === 26 && telemetry.ecgStatus === 'STEMI') {
        dy = -16; // ST-elevation elevation plateau!
      } else if (beatPhase === 32) {
        dy = -10; // T wave
      }

      const nextX = (x + 2) % width;
      const nextY = midY + dy;

      ctx.lineTo(nextX, nextY);
      ctx.stroke();

      x = nextX;
      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isOpen, telemetry.ecgStatus]);

  if (!isOpen) return null;

  const formatETA = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPhysicianMessage.trim()) return;
    setIntercomMessages((prev) => [
      ...prev,
      {
        sender: 'Base Hospital (Attending ER Physician)',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        message: newPhysicianMessage.trim(),
      },
    ]);
    setNewPhysicianMessage('');
  };

  const handleConfirmIntake = () => {
    setIsAdmitting(true);
    setTimeout(() => {
      setIsAdmitting(false);
      onDirectIntake(telemetry);
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 animate-in fade-in">
      <div className="bg-slate-900 text-slate-100 rounded-2xl max-w-3xl w-full border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center font-bold">
              <Ambulance className="w-5 h-5 animate-pulse" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-sm text-slate-100">{telemetry.unit}</h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-black bg-rose-600 text-white animate-pulse">
                  PRE-ARRIVAL TELEMETRY
                </span>
                {telemetry.codeAlert && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-500 text-slate-950">
                    CODE {telemetry.codeAlert}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Patient: <strong className="text-slate-200">{telemetry.patientName}</strong> ({telemetry.gender},{' '}
                {telemetry.age}y) • Crew: {telemetry.crewLeader}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Real-time ETA */}
            <div className="text-right">
              <span className="text-[10px] text-slate-400 block font-semibold uppercase">Estimated Arrival</span>
              <span className="text-base font-black font-mono text-amber-400">
                {formatETA(secondsRemaining)}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          {/* Live ECG Canvas Monitor */}
          <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-slate-200">12-Lead Continuous Waveform Strip (Lead II)</span>
                <span className="text-[10px] text-slate-400 font-mono">25mm/s • 10mm/mV • 50Hz Filter</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/40">
                  {telemetry.ecgFinding}
                </span>
              </div>
            </div>

            {/* Canvas */}
            <div className="relative rounded-lg overflow-hidden border border-slate-800 bg-slate-950">
              <canvas
                ref={canvasRef}
                width={700}
                height={120}
                className="w-full h-28 block"
              />
              <div className="absolute top-2 right-3 flex items-center gap-3 font-mono text-xs">
                <span className="text-emerald-400 font-bold flex items-center gap-1">
                  <Heart className="w-3.5 h-3.5 text-rose-500 animate-ping" /> {telemetry.vitals.hr} BPM
                </span>
                <span className="text-cyan-400 font-bold">SpO2 {telemetry.vitals.spo2}%</span>
                <span className="text-amber-400 font-bold">EtCO2 {telemetry.vitals.etco2} mmHg</span>
              </div>
            </div>
          </div>

          {/* Vitals & Field Parameters */}
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-center">
            <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 block font-semibold">HEART RATE</span>
              <span className="text-sm font-black text-rose-400 mt-0.5 block">{telemetry.vitals.hr} bpm</span>
            </div>
            <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 block font-semibold">BLOOD PRESS.</span>
              <span className="text-sm font-black text-slate-200 mt-0.5 block">{telemetry.vitals.bp}</span>
            </div>
            <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 block font-semibold">SPO2 OXYGEN</span>
              <span className="text-sm font-black text-cyan-400 mt-0.5 block">{telemetry.vitals.spo2}%</span>
            </div>
            <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 block font-semibold">GLASGOW COMA</span>
              <span className="text-sm font-black text-amber-400 mt-0.5 block">{telemetry.vitals.gcs} / 15</span>
            </div>
            <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 block font-semibold">ETCO2 CAPNO</span>
              <span className="text-sm font-black text-emerald-400 mt-0.5 block">{telemetry.vitals.etco2} mmHg</span>
            </div>
            <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 block font-semibold">BODY TEMP</span>
              <span className="text-sm font-black text-slate-200 mt-0.5 block">{telemetry.vitals.tempC}°C</span>
            </div>
          </div>

          {/* Chief Complaint & Field Actions */}
          <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800 space-y-1">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
              Chief Complaint & Field Assessment
            </span>
            <p className="text-slate-200 font-medium text-xs">&ldquo;{telemetry.chiefComplaint}&rdquo;</p>
            {telemetry.mechanism && (
              <p className="text-slate-400 text-[11px]">Mechanism: {telemetry.mechanism}</p>
            )}
          </div>

          {/* Two-Way Paramedic Radio Audio Intercom */}
          <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-indigo-400" />
                <span className="font-bold text-slate-200">2-Way Paramedic Medical Consultation Intercom</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-800">
                  {telemetry.radioChannel}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsRadioMuted(!isRadioMuted)}
                className="text-slate-400 hover:text-slate-200 flex items-center gap-1 text-[11px]"
              >
                {isRadioMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5 text-emerald-400" />}
                <span>{isRadioMuted ? 'Muted' : 'Live Audio Active'}</span>
              </button>
            </div>

            {/* Message Log */}
            <div className="space-y-2 max-h-32 overflow-y-auto p-2.5 bg-slate-900 rounded-lg border border-slate-800 text-[11px]">
              {intercomMessages.map((msg, i) => (
                <div key={i} className="space-y-0.5">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="font-bold text-slate-300">{msg.sender}</span>
                    <span>{msg.time}</span>
                  </div>
                  <p className="text-slate-200 font-mono">{msg.message}</p>
                </div>
              ))}
            </div>

            {/* Send Radio Order */}
            <form onSubmit={handleSendMessage} className="flex gap-2">
              <input
                type="text"
                value={newPhysicianMessage}
                onChange={(e) => setNewPhysicianMessage(e.target.value)}
                placeholder="Transmit standing medical orders to en-route paramedic unit..."
                className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 placeholder:text-slate-500 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 text-xs"
              />
              <button
                type="submit"
                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Transmit</span>
              </button>
            </form>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-400 text-xs">
            <Bed className="w-4 h-4 text-indigo-400" />
            <span>Target Resuscitation Bay: </span>
            <strong className="text-slate-200">{telemetry.preparedBay}</strong>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200 rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Dismiss
            </button>
            <button
              type="button"
              id="btn-stat-bay-intake"
              disabled={isAdmitting}
              onClick={handleConfirmIntake}
              className="px-5 py-2 text-xs font-black bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-lg transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isAdmitting ? (
                <span>Auto-Staging Resus Bay...</span>
              ) : (
                <>
                  <Flame className="w-4 h-4" />
                  <span>STAT Ingestion & Auto-Stage {telemetry.preparedBay}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
