'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import {
  Video,
  Mic,
  MicOff,
  VideoOff,
  PhoneOff,
  Users,
  MessageSquare,
  FileText,
  Clock,
  Sparkles,
  CheckCircle2,
  Calendar,
  Send,
  Share2,
  Volume2,
  VolumeX,
  Pill,
  Save,
  Download,
  AlertCircle,
  Stethoscope,
  Activity,
  Check,
} from 'lucide-react';

interface TelehealthAppointment {
  id: string;
  patientName: string;
  patientMrn: string;
  age: number;
  gender: string;
  timeSlot: string;
  specialty: string;
  physician: string;
  status: 'in_call' | 'waiting' | 'completed';
  chiefComplaint: string;
  history: string;
  vitals: {
    bp: string;
    hr: number;
    spo2: number;
  };
}

interface SoapNote {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

interface EPrescriptionItem {
  id: string;
  medication: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
}

export function TelehealthView() {
  const { patients } = useHospital();
  const [inCall, setInCall] = useState(true);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [activeCallTimeSeconds, setActiveCallTimeSeconds] = useState(504); // 08:24
  const [selectedTab, setSelectedTab] = useState<'soap' | 'rx' | 'vitals'>('soap');

  const [appointments, setAppointments] = useState<TelehealthAppointment[]>([
    {
      id: 'tele-01',
      patientName: 'Carlos Hernandez',
      patientMrn: 'GH-2026-8902',
      age: 58,
      gender: 'Male',
      timeSlot: '09:00 AM - 09:30 AM',
      specialty: 'Cardiology Remote Consult',
      physician: 'Dr. Sarah Jenkins, MD',
      status: 'in_call',
      chiefComplaint: 'Post-discharge hypertension review & medication titration',
      history: 'Essential Hypertension (10 yrs), Hyperlipidemia. Discharged post-NSTEMI stent 3 weeks ago.',
      vitals: {
        bp: '136/86 mmHg',
        hr: 74,
        spo2: 98,
      },
    },
    {
      id: 'tele-02',
      patientName: 'Amina Zahra',
      patientMrn: 'GH-2026-5120',
      age: 44,
      gender: 'Female',
      timeSlot: '09:30 AM - 09:50 AM',
      specialty: 'Endocrinology & Diabetes',
      physician: 'Dr. Kamran Baig, MD',
      status: 'waiting',
      chiefComplaint: 'Continuous Glucose Monitor (CGM) sensor review & HbA1c titration',
      history: 'Type 2 Diabetes Mellitus on Basal/Bolus insulin regimen, Dexcom G7 CGM user.',
      vitals: {
        bp: '124/78 mmHg',
        hr: 78,
        spo2: 99,
      },
    },
    {
      id: 'tele-03',
      patientName: 'Liam O\'Connor',
      patientMrn: 'GH-2026-6411',
      age: 36,
      gender: 'Male',
      timeSlot: '10:00 AM - 10:20 AM',
      specialty: 'Pulmonology Telehealth',
      physician: 'Dr. Michael Chang, MD',
      status: 'waiting',
      chiefComplaint: 'Asthma exacerbation follow-up, inhaler technique validation',
      history: 'Moderate Persistent Asthma, Allergic Rhinitis.',
      vitals: {
        bp: '118/74 mmHg',
        hr: 82,
        spo2: 97,
      },
    },
  ]);

  const [activeApptId, setActiveApptId] = useState('tele-01');
  const activeAppt = appointments.find((a) => a.id === activeApptId) || appointments[0];

  const [liveTranscription, setLiveTranscription] = useState<Array<{ sender: string; text: string; time: string }>>([
    { sender: 'Dr. Jenkins', text: 'Good morning Mr. Hernandez. How has your blood pressure been tracking this week?', time: '09:01' },
    { sender: 'Carlos Hernandez', text: 'Good morning Doctor. It has been hovering around 135 over 85, but I felt a bit dizzy yesterday morning after taking the lisinopril.', time: '09:02' },
    { sender: 'Dr. Jenkins', text: 'Understood. Let us review your dosage and check if we need to adjust your water intake and hydration routine.', time: '09:03' },
    { sender: 'Carlos Hernandez', text: 'My home Omron monitor showed 136/86 this morning right before we connected. Pulse was 74.', time: '09:05' },
    { sender: 'Dr. Jenkins', text: 'That pulse rate is excellent. I am going to keep you on Lisinopril 10mg once daily in the morning, but make sure to take it after breakfast with full hydration.', time: '09:07' },
  ]);

  const [chatMessage, setChatMessage] = useState('');
  const [isAiGeneratingSoap, setIsAiGeneratingSoap] = useState(false);
  const [soapGenerated, setSoapGenerated] = useState(true);

  const [soapNote, setSoapNote] = useState<SoapNote>({
    subjective: '58 y/o male presenting via encrypted telehealth for follow-up of essential hypertension and post-stent recovery. Patient reports mild dizziness post-dosing yesterday, otherwise asymptomatic. Home BP logs: 136/86 mmHg, HR 74 bpm. Denies chest pain, orthopnea, or lower extremity edema.',
    objective: 'Appears comfortable via high-definition video. Telemetry vitals verified: BP 136/86 mmHg, HR 74 bpm regular, SpO2 98% on room air. Speech clear, no respiratory distress during conversation.',
    assessment: '1. Primary Hypertension, controlled with current ACE-inhibitor regimen (ICD-10: I10).\n2. Status post-coronary intervention (I25.10) - stable hemodynamic profile.',
    plan: '1. Continue Lisinopril 10mg PO Daily with food/water.\n2. Maintain daily morning and evening BP log; threshold alert if systolic >150 or <100 mmHg.\n3. Virtual follow-up in 6 weeks or sooner if orthostatic dizziness recurs.',
  });

  const [prescriptions, setPrescriptions] = useState<EPrescriptionItem[]>([
    {
      id: 'rx-1',
      medication: 'Lisinopril Tablets USP',
      dosage: '10 mg',
      frequency: 'Once Daily (Morning)',
      duration: '90 Days (Refills: 3)',
      instructions: 'Take 1 tablet by mouth daily after breakfast with a full glass of water.',
    },
    {
      id: 'rx-2',
      medication: 'Atorvastatin Calcium',
      dosage: '40 mg',
      frequency: 'Once Daily (Bedtime)',
      duration: '90 Days (Refills: 3)',
      instructions: 'Take 1 tablet by mouth at bedtime.',
    },
  ]);

  const [newMed, setNewMed] = useState('');
  const [newDose, setNewDose] = useState('');
  const [newFreq, setNewFreq] = useState('');
  const [newDuration, setNewDuration] = useState('');
  const [newInstructions, setNewInstructions] = useState('');
  const [showAddRx, setShowAddRx] = useState(false);
  const [eRxSubmitted, setERxSubmitted] = useState(false);

  // Call timer simulation
  useEffect(() => {
    if (!inCall) return;
    const interval = setInterval(() => {
      setActiveCallTimeSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [inCall]);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    setLiveTranscription((prev) => [
      ...prev,
      { sender: 'Dr. Jenkins', text: chatMessage.trim(), time: timeStr },
    ]);
    setChatMessage('');
  };

  const handleSynthesizeSoap = () => {
    setIsAiGeneratingSoap(true);
    setTimeout(() => {
      setIsAiGeneratingSoap(false);
      setSoapGenerated(true);
    }, 1200);
  };

  const handleAddPrescription = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMed.trim() || !newDose.trim()) return;
    const item: EPrescriptionItem = {
      id: `rx-${Date.now()}`,
      medication: newMed.trim(),
      dosage: newDose.trim(),
      frequency: newFreq.trim() || 'Once Daily',
      duration: newDuration.trim() || '30 Days',
      instructions: newInstructions.trim() || 'Take as directed by physician.',
    };
    setPrescriptions((prev) => [...prev, item]);
    setNewMed('');
    setNewDose('');
    setNewFreq('');
    setNewDuration('');
    setNewInstructions('');
    setShowAddRx(false);
  };

  const handleTransmitERx = () => {
    setERxSubmitted(true);
    setTimeout(() => setERxSubmitted(false), 4000);
  };

  const handleSelectAppointment = (appt: TelehealthAppointment) => {
    setActiveApptId(appt.id);
    if (appt.status === 'waiting') {
      setAppointments((prev) =>
        prev.map((a) => (a.id === appt.id ? { ...a, status: 'in_call' } : a))
      );
      setInCall(true);
      setActiveCallTimeSeconds(0);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center font-bold">
              <Video className="w-4 h-4" />
            </span>
            <h1 className="text-lg font-bold text-slate-900">Telehealth & Remote Care Clinic</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            WebRTC Encrypted Virtual Consultations, Live AI Ambient Speech-to-SOAP, Surescripts E-Prescribing & Remote Vitals
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-emerald-50 text-emerald-700 font-bold text-xs rounded-lg border border-emerald-200 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            WebRTC Stream: AES-256 (HIPAA Compliant)
          </span>
          <span className="px-3 py-1 bg-blue-50 text-blue-700 font-bold text-xs rounded-lg border border-blue-200">
            Surescripts E-Rx Gateway Online
          </span>
        </div>
      </div>

      {/* Main Studio */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Video Studio & Ambient Transcriber (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-slate-950 rounded-2xl overflow-hidden shadow-lg border border-slate-800 flex flex-col h-[440px] relative">
            {/* Top Call Overlay */}
            <div className="p-4 bg-gradient-to-b from-black/80 to-transparent absolute top-0 left-0 right-0 z-10 flex items-center justify-between text-white">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${inCall ? 'bg-emerald-500 animate-ping' : 'bg-rose-500'}`} />
                <span className="text-xs font-bold">{activeAppt.patientName}</span>
                <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded font-mono font-bold">
                  {formatTimer(activeCallTimeSeconds)} / 30:00
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-teal-300 font-mono bg-teal-950/80 px-2.5 py-0.5 rounded-md border border-teal-800">
                  {activeAppt.specialty}
                </span>
              </div>
            </div>

            {/* Video Canvas Simulation */}
            <div className="flex-1 flex items-center justify-center relative bg-gradient-to-b from-slate-900 to-slate-950">
              {inCall ? (
                <div className="text-center space-y-3">
                  <div className="w-24 h-24 rounded-full bg-teal-600/30 border-2 border-teal-400 text-teal-200 mx-auto flex items-center justify-center font-black text-2xl shadow-inner">
                    {activeAppt.patientName.split(' ').map((n) => n[0]).join('')}
                  </div>
                  <div className="text-slate-200">
                    <h3 className="font-bold text-sm">{activeAppt.patientName}</h3>
                    <p className="text-xs text-emerald-400 flex items-center justify-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      1080p HD Video & Full-Duplex Audio Active
                    </p>
                  </div>

                  {/* Real-time Vitals Overlay */}
                  <div className="inline-flex items-center gap-3 bg-slate-900/90 border border-slate-700/80 px-3 py-1.5 rounded-xl text-[11px] text-slate-300 font-mono">
                    <span>BP: <strong className="text-white">{activeAppt.vitals.bp}</strong></span>
                    <span>•</span>
                    <span>HR: <strong className="text-white">{activeAppt.vitals.hr} bpm</strong></span>
                    <span>•</span>
                    <span>SpO2: <strong className="text-emerald-400">{activeAppt.vitals.spo2}%</strong></span>
                  </div>
                </div>
              ) : (
                <div className="text-center space-y-2 text-slate-400">
                  <PhoneOff className="w-10 h-10 mx-auto text-slate-600" />
                  <p className="text-sm font-bold text-slate-300">Call Ended</p>
                  <p className="text-xs">Finalize clinical SOAP note and e-prescription below</p>
                  <button
                    onClick={() => {
                      setInCall(true);
                      setActiveCallTimeSeconds(0);
                    }}
                    className="mt-2 px-3.5 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-xs font-bold"
                  >
                    Reconnect Call
                  </button>
                </div>
              )}

              {/* Doctor PiP Video Feed */}
              {inCall && (
                <div className="absolute bottom-16 right-4 w-36 h-26 bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-2xl flex flex-col items-center justify-center text-xs text-slate-400">
                  {cameraOff ? (
                    <VideoOff className="w-6 h-6 text-rose-400 mb-1" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-indigo-600/40 border border-indigo-400 text-indigo-200 flex items-center justify-center font-bold text-xs mb-1">
                      SJ
                    </div>
                  )}
                  <span className="font-semibold text-[10px] text-slate-300">{activeAppt.physician}</span>
                </div>
              )}
            </div>

            {/* Bottom Call Controls */}
            <div className="p-3 bg-slate-900 border-t border-slate-800 flex items-center justify-between px-6 z-10">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMicMuted(!micMuted)}
                  className={`p-2.5 rounded-xl text-white cursor-pointer transition-all ${
                    micMuted ? 'bg-rose-600' : 'bg-slate-800 hover:bg-slate-700'
                  }`}
                  title={micMuted ? 'Unmute Microphone' : 'Mute Microphone'}
                >
                  {micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>

                <button
                  onClick={() => setCameraOff(!cameraOff)}
                  className={`p-2.5 rounded-xl text-white cursor-pointer transition-all ${
                    cameraOff ? 'bg-rose-600' : 'bg-slate-800 hover:bg-slate-700'
                  }`}
                  title={cameraOff ? 'Turn Camera On' : 'Turn Camera Off'}
                >
                  {cameraOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                </button>

                <button
                  onClick={() => setSpeakerMuted(!speakerMuted)}
                  className={`p-2.5 rounded-xl text-white cursor-pointer transition-all ${
                    speakerMuted ? 'bg-rose-600' : 'bg-slate-800 hover:bg-slate-700'
                  }`}
                  title={speakerMuted ? 'Unmute Speaker' : 'Mute Speaker'}
                >
                  {speakerMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
              </div>

              <div className="flex items-center gap-2">
                {inCall ? (
                  <button
                    onClick={() => setInCall(false)}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-md"
                  >
                    <PhoneOff className="w-4 h-4" /> End Call
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setInCall(true);
                      setActiveCallTimeSeconds(0);
                    }}
                    className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-md"
                  >
                    <Video className="w-4 h-4" /> Start Call
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Real-Time Ambient Transcription */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center">
                  <Sparkles className="w-3.5 h-3.5" />
                </span>
                <h3 className="text-xs font-bold text-slate-900">
                  Ambient Clinical Speech Stream (Real-Time Whisper Extraction)
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live Listening
                </span>
                <button
                  onClick={handleSynthesizeSoap}
                  disabled={isAiGeneratingSoap}
                  className="px-2.5 py-1 bg-gradient-to-r from-teal-600 to-indigo-600 hover:from-teal-500 hover:to-indigo-500 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 shadow-xs cursor-pointer disabled:opacity-50"
                >
                  <Sparkles className="w-3 h-3 text-amber-300" />
                  {isAiGeneratingSoap ? 'Synthesizing...' : 'Regenerate SOAP'}
                </button>
              </div>
            </div>

            <div className="max-h-48 overflow-y-auto space-y-2 text-xs font-mono bg-slate-50 p-3.5 rounded-xl border border-slate-200">
              {liveTranscription.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <span className="text-[10px] text-slate-400 font-semibold">{item.time}</span>
                  <span
                    className={`font-bold ${
                      item.sender.includes('Dr.') ? 'text-teal-700' : 'text-slate-800'
                    }`}
                  >
                    {item.sender}:
                  </span>
                  <p className="text-slate-700 leading-relaxed flex-1">{item.text}</p>
                </div>
              ))}
            </div>

            <form onSubmit={handleSendMessage} className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                placeholder="Type doctor statement or clinical question into speech buffer..."
                className="flex-1 text-xs border border-slate-200 rounded-xl px-3.5 py-2 bg-slate-50 focus:bg-white focus:ring-1 focus:ring-teal-500"
              />
              <button
                type="submit"
                className="px-3.5 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" /> Inject
              </button>
            </form>
          </div>
        </div>

        {/* Right: Clinical EHR Integration Workbench (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Waiting Room Selector */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-teal-600" />
                Virtual Clinic Roster ({appointments.length})
              </h3>
              <span className="text-[10px] font-bold text-slate-500">Click to Switch Patient</span>
            </div>

            <div className="space-y-2">
              {appointments.map((appt) => (
                <div
                  key={appt.id}
                  onClick={() => handleSelectAppointment(appt)}
                  className={`p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                    activeApptId === appt.id
                      ? 'bg-teal-50/60 border-teal-300 ring-2 ring-teal-500/20'
                      : 'bg-slate-50 hover:bg-slate-100/70 border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{appt.patientName}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                        appt.status === 'in_call'
                          ? 'bg-teal-600 text-white animate-pulse'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {appt.status === 'in_call' ? 'CONNECTED' : 'WAITING'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 flex items-center justify-between pt-1">
                    <span>{appt.patientMrn} • {appt.age}y {appt.gender}</span>
                    <span className="font-mono">{appt.timeSlot}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Clinical Tab Panel */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setSelectedTab('soap')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    selectedTab === 'soap'
                      ? 'bg-teal-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  AI SOAP Note
                </button>
                <button
                  onClick={() => setSelectedTab('rx')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    selectedTab === 'rx'
                      ? 'bg-teal-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  E-Prescribing ({prescriptions.length})
                </button>
                <button
                  onClick={() => setSelectedTab('vitals')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    selectedTab === 'vitals'
                      ? 'bg-teal-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Remote Vitals
                </button>
              </div>
            </div>

            {/* Tab 1: AI SOAP Note */}
            {selectedTab === 'soap' && (
              <div className="space-y-3 text-xs">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Subjective (S)</label>
                  <textarea
                    rows={3}
                    value={soapNote.subjective}
                    onChange={(e) => setSoapNote({ ...soapNote, subjective: e.target.value })}
                    className="w-full text-xs font-mono border border-slate-200 rounded-xl p-2.5 bg-slate-50 focus:bg-white focus:ring-1 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Objective (O)</label>
                  <textarea
                    rows={2}
                    value={soapNote.objective}
                    onChange={(e) => setSoapNote({ ...soapNote, objective: e.target.value })}
                    className="w-full text-xs font-mono border border-slate-200 rounded-xl p-2.5 bg-slate-50 focus:bg-white focus:ring-1 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Assessment (A)</label>
                  <textarea
                    rows={2}
                    value={soapNote.assessment}
                    onChange={(e) => setSoapNote({ ...soapNote, assessment: e.target.value })}
                    className="w-full text-xs font-mono border border-slate-200 rounded-xl p-2.5 bg-slate-50 focus:bg-white focus:ring-1 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Plan & Rx (P)</label>
                  <textarea
                    rows={3}
                    value={soapNote.plan}
                    onChange={(e) => setSoapNote({ ...soapNote, plan: e.target.value })}
                    className="w-full text-xs font-mono border border-slate-200 rounded-xl p-2.5 bg-slate-50 focus:bg-white focus:ring-1 focus:ring-teal-500"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    onClick={() => alert(`SOAP note for ${activeAppt.patientName} (${activeAppt.patientMrn}) permanently signed and archived into Master Patient Index EHR.`)}
                    className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" /> Sign & Post to Patient EHR
                  </button>
                </div>
              </div>
            )}

            {/* Tab 2: Surescripts E-Prescribing */}
            {selectedTab === 'rx' && (
              <div className="space-y-4 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">Prescription Order Set</span>
                  <button
                    onClick={() => setShowAddRx(!showAddRx)}
                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-[11px] font-bold cursor-pointer"
                  >
                    {showAddRx ? 'Cancel' : '+ Add Medication'}
                  </button>
                </div>

                {showAddRx && (
                  <form onSubmit={handleAddPrescription} className="p-3 bg-teal-50/50 rounded-xl border border-teal-200 space-y-2">
                    <h4 className="font-bold text-teal-950 text-xs">New Electronic Prescription</h4>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Drug Name (e.g. Lisinopril)"
                        value={newMed}
                        onChange={(e) => setNewMed(e.target.value)}
                        className="text-xs p-2 bg-white border border-slate-200 rounded-lg"
                        required
                      />
                      <input
                        type="text"
                        placeholder="Strength (e.g. 10 mg)"
                        value={newDose}
                        onChange={(e) => setNewDose(e.target.value)}
                        className="text-xs p-2 bg-white border border-slate-200 rounded-lg"
                        required
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Frequency (e.g. Once Daily)"
                        value={newFreq}
                        onChange={(e) => setNewFreq(e.target.value)}
                        className="text-xs p-2 bg-white border border-slate-200 rounded-lg"
                      />
                      <input
                        type="text"
                        placeholder="Duration (e.g. 90 Days)"
                        value={newDuration}
                        onChange={(e) => setNewDuration(e.target.value)}
                        className="text-xs p-2 bg-white border border-slate-200 rounded-lg"
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="Patient Sig / Instructions"
                      value={newInstructions}
                      onChange={(e) => setNewInstructions(e.target.value)}
                      className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg"
                    />
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="submit"
                        className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-xs font-bold"
                      >
                        Save Prescription
                      </button>
                    </div>
                  </form>
                )}

                <div className="space-y-2">
                  {prescriptions.map((rx) => (
                    <div key={rx.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">{rx.medication}</span>
                        <span className="px-2 py-0.5 bg-teal-100 text-teal-800 font-bold rounded text-[10px]">
                          {rx.dosage}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600">{rx.instructions}</p>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {rx.frequency} • Duration: {rx.duration}
                      </div>
                    </div>
                  ))}
                </div>

                {eRxSubmitted && (
                  <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl flex items-center gap-2 text-emerald-800 text-xs font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Prescriptions successfully routed via Surescripts to CVS Pharmacy #4021.
                  </div>
                )}

                <div className="pt-2 border-t border-slate-100 flex justify-end">
                  <button
                    onClick={handleTransmitERx}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" /> Transmit Electronic E-Rx to Pharmacy
                  </button>
                </div>
              </div>
            )}

            {/* Tab 3: Remote Vitals & Bio-Telemetry */}
            {selectedTab === 'vitals' && (
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">Blood Pressure</span>
                    <span className="text-base font-black text-slate-900 mt-0.5 block">{activeAppt.vitals.bp}</span>
                    <span className="text-[10px] text-emerald-600 font-bold">Within Target</span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">Heart Rate</span>
                    <span className="text-base font-black text-slate-900 mt-0.5 block">{activeAppt.vitals.hr} bpm</span>
                    <span className="text-[10px] text-slate-500">Normal Sinus</span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">SpO2 Oxygen</span>
                    <span className="text-base font-black text-emerald-600 mt-0.5 block">{activeAppt.vitals.spo2}%</span>
                    <span className="text-[10px] text-emerald-700">Room Air</span>
                  </div>
                </div>

                <div className="p-3.5 bg-teal-50/50 rounded-xl border border-teal-100 space-y-1.5">
                  <h4 className="font-bold text-teal-950 text-xs flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-teal-600" />
                    Patient Connected Device Profile
                  </h4>
                  <p className="text-slate-600 text-[11px]">
                    Device: <strong>Omron Evolv Wireless Blood Pressure Monitor (BLE Sync)</strong>
                  </p>
                  <p className="text-slate-500 text-[10px]">
                    Last automated synchronization: 14 minutes ago. 7-day adherence rate: 94.2%.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
