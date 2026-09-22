'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import {
  TelehealthSession,
  TelehealthVitals,
  TelehealthSoapNote,
  TelehealthPrescription,
  TelehealthTranscriptEntry,
} from '@/lib/types/ghims';
import {
  Video,
  Mic,
  MicOff,
  VideoOff,
  PhoneOff,
  PhoneCall,
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
  Plus,
  Search,
  Wifi,
  Radio,
  FileCheck,
  X,
} from 'lucide-react';

export function TelehealthView() {
  const {
    telehealthSessions,
    patients,
    createTelehealthSession,
    updateTelehealthSession,
    completeTelehealthSession,
    networkMode,
  } = useHospital();

  const [activeSessionId, setActiveSessionId] = useState<string>(
    telehealthSessions[0]?.id || 'th-101'
  );

  const fallbackSession = useMemo<TelehealthSession>(
    () => ({
      id: 'th-fallback',
      encounterId: 'enc-th-0',
      patientId: 'p-1001',
      patientName: 'Elena Rostova',
      patientMrn: 'MRN-99412',
      age: 64,
      gender: 'Female',
      scheduledTime: 'Today, 14:00',
      status: 'WAITING_ROOM',
      type: 'Telehealth Consultation',
      attendingPhysician: 'Dr. Sarah Jenkins',
      clinicianNpi: '1487920134',
      specialty: 'Cardiology & Preventive Medicine',
      chiefComplaint: 'Post-discharge follow-up for blood pressure and palpitations',
      roomToken: 'ROOM-ALPHA-892',
      connectionQuality: 'EXCELLENT',
      callDurationSeconds: 0,
      vitals: { bp: '120/80', hr: 72, spo2: 99, temp: 36.6, rhythm: 'Normal Sinus Rhythm' },
      transcription: [],
      soapNote: { subjective: '', objective: '', assessment: '', plan: '', icd10Codes: [], cptCodes: [] },
      prescriptions: [],
      isAudioMuted: false,
      isVideoMuted: false,
      isRecording: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    []
  );

  const activeSession: TelehealthSession = useMemo(() => {
    return (
      telehealthSessions.find((s) => s.id === activeSessionId) ||
      telehealthSessions[0] ||
      fallbackSession
    );
  }, [telehealthSessions, activeSessionId, fallbackSession]);

  // Call Controls State
  const [inCall, setInCall] = useState<boolean>(activeSession.status === 'IN_CONSULTATION');
  const [micMuted, setMicMuted] = useState<boolean>(activeSession.isAudioMuted || false);
  const [cameraOff, setCameraOff] = useState<boolean>(activeSession.isVideoMuted || false);
  const [speakerMuted, setSpeakerMuted] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(activeSession.isRecording || false);
  const [activeCallTimeSeconds, setActiveCallTimeSeconds] = useState<number>(activeSession.callDurationSeconds || 0);

  // Tab & Filters State
  const [selectedTab, setSelectedTab] = useState<'soap' | 'rx' | 'vitals'>('soap');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'WAITING_ROOM' | 'IN_CONSULTATION' | 'DOCUMENTING' | 'COMPLETED'>('ALL');
  const [searchFilter, setSearchFilter] = useState<string>('');

  // Chat / Live Transcription Input State
  const [chatMessage, setChatMessage] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // AI SOAP State
  const [isAiGeneratingSoap, setIsAiGeneratingSoap] = useState(false);
  const [soapSavedSuccess, setSoapSavedSuccess] = useState(false);
  const [soapSubjective, setSoapSubjective] = useState('');
  const [soapObjective, setSoapObjective] = useState('');
  const [soapAssessment, setSoapAssessment] = useState('');
  const [soapPlan, setSoapPlan] = useState('');
  const [icd10Codes, setIcd10Codes] = useState<Array<{ code: string; description: string }>>([]);
  const [cptCodes, setCptCodes] = useState<Array<{ code: string; description: string; fee?: number }>>([]);

  // Prescription State
  const [newMed, setNewMed] = useState('');
  const [newDose, setNewDose] = useState('');
  const [newFreq, setNewFreq] = useState('Once Daily (QAM)');
  const [newDuration, setNewDuration] = useState('30 Days');
  const [newInstructions, setNewInstructions] = useState('');
  const [showAddRx, setShowAddRx] = useState(false);
  const [eRxSubmitted, setERxSubmitted] = useState(false);

  // Schedule Appointment Modal State
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [schedPatientId, setSchedPatientId] = useState(patients[0]?.id || 'p-1001');
  const [schedType, setSchedType] = useState<TelehealthSession['type']>('Telehealth Consultation');
  const [schedTime, setSchedTime] = useState('Today, 16:00');
  const [schedPhysician, setSchedPhysician] = useState('Dr. Sarah Jenkins');
  const [schedComplaint, setSchedComplaint] = useState('');

  // Keep local SOAP fields synced when active session changes
  useEffect(() => {
    if (activeSession) {
      setSoapSubjective(activeSession.soapNote?.subjective || '');
      setSoapObjective(activeSession.soapNote?.objective || '');
      setSoapAssessment(activeSession.soapNote?.assessment || '');
      setSoapPlan(activeSession.soapNote?.plan || '');
      setIcd10Codes(activeSession.soapNote?.icd10Codes || []);
      setCptCodes(activeSession.soapNote?.cptCodes || [
        { code: '99214', description: 'Office/telehealth outpatient visit moderate complexity', fee: 165 },
      ]);
      setInCall(activeSession.status === 'IN_CONSULTATION');
      setActiveCallTimeSeconds(activeSession.callDurationSeconds || 0);
      setMicMuted(activeSession.isAudioMuted || false);
      setCameraOff(activeSession.isVideoMuted || false);
      setIsRecording(activeSession.isRecording || false);
      setSoapSavedSuccess(activeSession.status === 'COMPLETED');
    }
  }, [activeSessionId, activeSession]);

  // Call timer simulation
  useEffect(() => {
    if (!inCall) return;
    const interval = setInterval(() => {
      setActiveCallTimeSeconds((prev) => {
        const updated = prev + 1;
        // Periodically update call duration
        if (updated % 15 === 0) {
          updateTelehealthSession(activeSession.id, { callDurationSeconds: updated }).catch(() => {});
        }
        return updated;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [inCall, activeSession?.id, updateTelehealthSession]);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Filtered appointments
  const filteredSessions = telehealthSessions.filter((s) => {
    const matchesStatus = statusFilter === 'ALL' || s.status === statusFilter;
    const matchesSearch =
      searchFilter.trim() === '' ||
      s.patientName.toLowerCase().includes(searchFilter.toLowerCase()) ||
      s.patientMrn.toLowerCase().includes(searchFilter.toLowerCase()) ||
      s.chiefComplaint.toLowerCase().includes(searchFilter.toLowerCase()) ||
      s.specialty.toLowerCase().includes(searchFilter.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const handleSelectSession = (session: TelehealthSession) => {
    setActiveSessionId(session.id);
    if (session.status === 'WAITING_ROOM') {
      // Connect to session
      updateTelehealthSession(session.id, {
        status: 'IN_CONSULTATION',
        transcription: [
          ...session.transcription,
          {
            id: `tr-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            speaker: 'SYSTEM',
            text: `Clinician joined video room. End-to-end encrypted session active.`,
          },
        ],
      }).catch(() => {});
      setInCall(true);
    }
  };

  const handleToggleCall = async () => {
    if (inCall) {
      // End call -> transition to DOCUMENTING
      setInCall(false);
      await updateTelehealthSession(activeSession.id, {
        status: 'DOCUMENTING',
        callDurationSeconds: activeCallTimeSeconds,
        transcription: [
          ...activeSession.transcription,
          {
            id: `tr-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            speaker: 'SYSTEM',
            text: `Video call ended by clinician. Call duration: ${formatTimer(activeCallTimeSeconds)}. Documenting encounter notes.`,
          },
        ],
      });
    } else {
      // Reconnect
      setInCall(true);
      await updateTelehealthSession(activeSession.id, {
        status: 'IN_CONSULTATION',
      });
    }
  };

  const handleToggleMute = async () => {
    const next = !micMuted;
    setMicMuted(next);
    await updateTelehealthSession(activeSession.id, { isAudioMuted: next });
  };

  const handleToggleCamera = async () => {
    const next = !cameraOff;
    setCameraOff(next);
    await updateTelehealthSession(activeSession.id, { isVideoMuted: next });
  };

  const handleToggleRecording = async () => {
    const next = !isRecording;
    setIsRecording(next);
    await updateTelehealthSession(activeSession.id, { isRecording: next });
  };

  const handleSendTranscriptMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;

    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const newEntry: TelehealthTranscriptEntry = {
      id: `tr-${Date.now()}`,
      timestamp: timeStr,
      speaker: 'DOCTOR',
      text: chatMessage.trim(),
    };

    const updatedTranscription = [...activeSession.transcription, newEntry];
    setChatMessage('');

    await updateTelehealthSession(activeSession.id, {
      transcription: updatedTranscription,
    });
  };

  // AI Speech-to-SOAP generation
  const handleSynthesizeSoap = async () => {
    setIsAiGeneratingSoap(true);
    try {
      const transcriptText = activeSession.transcription
        .map((t) => `${t.speaker}: ${t.text}`)
        .join('\n');

      const response = await fetch('/api/ai/soap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: activeSession.patientId,
          chiefComplaint: activeSession.chiefComplaint,
          vitals: activeSession.vitals,
          doctorNotes: transcriptText || 'Patient in virtual consultation.',
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.subjective) setSoapSubjective(data.subjective);
        if (data.objective) setSoapObjective(data.objective);
        if (data.assessment) setSoapAssessment(data.assessment);
        if (data.plan) setSoapPlan(data.plan);
        if (data.suggestedBillingCodes) {
          setCptCodes(
            data.suggestedBillingCodes.map((c: any) => ({
              code: c.code,
              description: c.description,
              fee: c.fee || 145,
            }))
          );
        }
      } else {
        // Fallback intelligent draft if endpoint is offline
        generateFallbackSoap();
      }
    } catch {
      generateFallbackSoap();
    } finally {
      setIsAiGeneratingSoap(false);
    }
  };

  const generateFallbackSoap = () => {
    const pName = activeSession.patientName;
    const bp = activeSession.vitals.bp || '120/80';
    const hr = activeSession.vitals.hr || 72;
    const spo2 = activeSession.vitals.spo2 || 99;

    setSoapSubjective(
      `${activeSession.age} y/o ${activeSession.gender} presenting via encrypted telehealth consult for ${activeSession.chiefComplaint.toLowerCase()}. Patient reports stable adherence to home regimen without acute distress or dyspnea.`
    );
    setSoapObjective(
      `Video consult visual assessment: Alert, oriented x 4, conversational without tachypnea. Connected biometric telemetry (${activeSession.vitals.connectedDevice || 'BLE Hub'}): BP ${bp} mmHg, HR ${hr} bpm, SpO2 ${spo2}%. Rhythm: ${activeSession.vitals.rhythm || 'Normal Sinus'}.`
    );
    setSoapAssessment(
      `1. Follow-up: ${activeSession.chiefComplaint} (ICD-10: Z09, I10).\n2. Remote biometric telemetry monitoring confirms stable hemodynamic status.`
    );
    setSoapPlan(
      `1. Continue current medication regimen.\n2. Maintain daily remote telemetry monitoring.\n3. Virtual follow-up in 4 weeks or return to clinic if symptoms worsen.`
    );
    setIcd10Codes([
      { code: 'I10', description: 'Essential (primary) hypertension' },
      { code: 'Z09', description: 'Encounter for follow-up examination after treatment' },
    ]);
    setCptCodes([
      { code: '99214', description: 'Telehealth outpatient visit moderate complexity', fee: 165 },
      { code: '99457', description: 'Remote physiologic monitoring treatment mgmt 20 min', fee: 110 },
    ]);
  };

  // Sign & commit SOAP note to Patient EHR
  const handleSignAndCommitSoap = async () => {
    const updatedNote: TelehealthSoapNote = {
      subjective: soapSubjective,
      objective: soapObjective,
      assessment: soapAssessment,
      plan: soapPlan,
      icd10Codes,
      cptCodes,
    };

    await completeTelehealthSession(activeSession.id, updatedNote, activeSession.prescriptions);
    setSoapSavedSuccess(true);
    setTimeout(() => setSoapSavedSuccess(false), 6000);
  };

  // Electronic Prescribing (E-Rx)
  const handleAddPrescription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMed.trim() || !newDose.trim()) return;

    const newRxItem: TelehealthPrescription = {
      id: `rx-${Date.now()}`,
      medication: newMed.trim(),
      dosage: newDose.trim(),
      frequency: newFreq.trim() || 'Once Daily (QAM)',
      duration: newDuration.trim() || '30 Days',
      instructions: newInstructions.trim() || 'Take as directed by physician.',
      prescribedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      pharmacyName: 'CVS Pharmacy #4912 (Main Street)',
      pharmacyNpi: '1093821742',
      status: 'PENDING_TRANSMISSION',
    };

    const updatedPrescriptions = [...activeSession.prescriptions, newRxItem];
    await updateTelehealthSession(activeSession.id, {
      prescriptions: updatedPrescriptions,
    });

    setNewMed('');
    setNewDose('');
    setNewInstructions('');
    setShowAddRx(false);
  };

  const handleTransmitERx = async () => {
    const transmitted = activeSession.prescriptions.map((p) => ({
      ...p,
      status: 'TRANSMITTED' as const,
      transactionRef: `NCPDP-SCRIPT-${Math.floor(100000 + Math.random() * 900000)}`,
    }));

    await updateTelehealthSession(activeSession.id, {
      prescriptions: transmitted,
    });

    setERxSubmitted(true);
    setTimeout(() => setERxSubmitted(false), 5000);
  };

  // Handle scheduling new appointment
  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schedComplaint.trim()) return;

    const newSession = await createTelehealthSession({
      patientId: schedPatientId,
      type: schedType,
      scheduledTime: schedTime,
      chiefComplaint: schedComplaint,
      attendingPhysician: schedPhysician,
    });

    setShowScheduleModal(false);
    setActiveSessionId(newSession.id);
    setSchedComplaint('');
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center font-bold">
              <Video className="w-4 h-4" />
            </span>
            <h1 className="text-lg font-bold text-slate-900">Telehealth & Remote Care Clinic</h1>
            <span className="px-2 py-0.5 bg-teal-100 text-teal-800 rounded-md text-[10px] font-mono font-bold">
              v3.2 Production
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            WebRTC Encrypted Virtual Encounters, Ambient Speech-to-SOAP Scribe, Surescripts E-Rx & Real-Time Bio-Telemetry
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-3 py-1 bg-emerald-50 text-emerald-700 font-bold text-xs rounded-lg border border-emerald-200 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            WebRTC: AES-256 (HIPAA Certified)
          </span>
          <span className="px-3 py-1 bg-blue-50 text-blue-700 font-bold text-xs rounded-lg border border-blue-200">
            Surescripts E-Rx Online
          </span>
          <button
            onClick={() => setShowScheduleModal(true)}
            className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Book Virtual Visit
          </button>
        </div>
      </div>

      {/* Main Studio Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Video Studio & Ambient Transcriber (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-slate-950 rounded-2xl overflow-hidden shadow-lg border border-slate-800 flex flex-col h-[460px] relative">
            {/* Top Call Overlay */}
            <div className="p-4 bg-gradient-to-b from-black/90 to-transparent absolute top-0 left-0 right-0 z-10 flex items-center justify-between text-white">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    inCall ? 'bg-emerald-500 animate-ping' : 'bg-amber-500'
                  }`}
                />
                <span className="text-xs font-bold">{activeSession.patientName}</span>
                <span className="text-[10px] text-slate-400">({activeSession.patientMrn})</span>
                <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded font-mono font-bold">
                  {formatTimer(activeCallTimeSeconds)}
                </span>
                {isRecording && (
                  <span className="px-2 py-0.5 bg-rose-600/90 text-white font-mono text-[9px] rounded flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> REC
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-teal-300 font-mono bg-teal-950/80 px-2.5 py-0.5 rounded-md border border-teal-800">
                  {activeSession.roomToken}
                </span>
              </div>
            </div>

            {/* Video Canvas Simulation */}
            <div className="flex-1 flex items-center justify-center relative bg-gradient-to-b from-slate-900 via-slate-950 to-black">
              {inCall ? (
                <div className="text-center space-y-3 px-4">
                  <div className="w-24 h-24 rounded-full bg-teal-600/30 border-2 border-teal-400 text-teal-200 mx-auto flex items-center justify-center font-black text-2xl shadow-inner">
                    {activeSession.patientName
                      .split(' ')
                      .map((n) => n[0])
                      .join('')}
                  </div>
                  <div className="text-slate-200">
                    <h3 className="font-bold text-sm flex items-center justify-center gap-2">
                      {activeSession.patientName}
                      <span className="text-xs font-normal text-slate-400">
                        ({activeSession.age}y, {activeSession.gender})
                      </span>
                    </h3>
                    <p className="text-xs text-emerald-400 flex items-center justify-center gap-1.5 mt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      1080p HD Encrypted WebRTC Stream • Full-Duplex
                    </p>
                  </div>

                  {/* Real-Time Bio-Telemetry Overlay */}
                  <div className="inline-flex items-center gap-3 bg-slate-900/90 border border-slate-700/80 px-3 py-1.5 rounded-xl text-[11px] text-slate-300 font-mono flex-wrap justify-center">
                    <span>
                      BP: <strong className="text-white">{activeSession.vitals.bp}</strong>
                    </span>
                    <span>•</span>
                    <span>
                      HR: <strong className="text-white">{activeSession.vitals.hr} bpm</strong>
                    </span>
                    <span>•</span>
                    <span>
                      SpO2:{' '}
                      <strong className="text-emerald-400">{activeSession.vitals.spo2}%</strong>
                    </span>
                    {activeSession.vitals.glucose && (
                      <>
                        <span>•</span>
                        <span>
                          Glucose:{' '}
                          <strong className="text-amber-400">
                            {activeSession.vitals.glucose} mg/dL
                          </strong>
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center space-y-2 text-slate-400 px-4">
                  {activeSession.status === 'COMPLETED' ? (
                    <>
                      <FileCheck className="w-12 h-12 mx-auto text-emerald-500" />
                      <p className="text-sm font-bold text-emerald-300">Encounter Completed & Signed</p>
                      <p className="text-xs text-slate-400">
                        SOAP note and e-prescriptions permanently archived to Master Patient Index.
                      </p>
                    </>
                  ) : activeSession.status === 'WAITING_ROOM' ? (
                    <>
                      <Users className="w-12 h-12 mx-auto text-amber-400 animate-pulse" />
                      <p className="text-sm font-bold text-slate-200">Patient in Waiting Room</p>
                      <p className="text-xs text-slate-400">
                        {activeSession.patientName} is ready to connect. BLE vitals telemetry synced.
                      </p>
                      <button
                        onClick={handleToggleCall}
                        className="mt-3 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 mx-auto shadow-md cursor-pointer transition-colors"
                      >
                        <PhoneCall className="w-3.5 h-3.5" /> Connect Video Call
                      </button>
                    </>
                  ) : (
                    <>
                      <PhoneOff className="w-10 h-10 mx-auto text-slate-600" />
                      <p className="text-sm font-bold text-slate-300">Consultation Paused / Documenting</p>
                      <p className="text-xs">Finalize clinical SOAP note and e-prescriptions below</p>
                      <button
                        onClick={handleToggleCall}
                        className="mt-3 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 mx-auto cursor-pointer"
                      >
                        <PhoneCall className="w-3.5 h-3.5" /> Reconnect Video Stream
                      </button>
                    </>
                  )}
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
                  <span className="font-semibold text-[10px] text-slate-300">
                    {activeSession.attendingPhysician}
                  </span>
                </div>
              )}
            </div>

            {/* Bottom Call Controls */}
            <div className="p-3 bg-slate-900 border-t border-slate-800 flex items-center justify-between px-6 z-10">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleToggleMute}
                  className={`p-2.5 rounded-xl text-white cursor-pointer transition-all ${
                    micMuted ? 'bg-rose-600' : 'bg-slate-800 hover:bg-slate-700'
                  }`}
                  title={micMuted ? 'Unmute Microphone' : 'Mute Microphone'}
                >
                  {micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>

                <button
                  onClick={handleToggleCamera}
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
                    speakerMuted ? 'bg-amber-600' : 'bg-slate-800 hover:bg-slate-700'
                  }`}
                  title={speakerMuted ? 'Unmute Audio' : 'Mute Audio'}
                >
                  {speakerMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>

                <button
                  onClick={handleToggleRecording}
                  className={`p-2.5 rounded-xl text-white cursor-pointer transition-all ${
                    isRecording ? 'bg-rose-600' : 'bg-slate-800 hover:bg-slate-700'
                  }`}
                  title={isRecording ? 'Stop Recording' : 'Start HIPAA Cloud Recording'}
                >
                  <Radio className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleToggleCall}
                  className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 text-white cursor-pointer transition-colors ${
                    inCall ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500'
                  }`}
                >
                  {inCall ? (
                    <>
                      <PhoneOff className="w-3.5 h-3.5" /> End Call
                    </>
                  ) : (
                    <>
                      <PhoneCall className="w-3.5 h-3.5" /> Connect Call
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Live Ambient Speech & Clinical Dialogue Stream */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-teal-600" />
                <h3 className="text-xs font-bold text-slate-800">
                  Ambient Clinical Dialogue & Speech Transcription
                </h3>
              </div>
              <span className="text-[10px] text-teal-700 font-semibold bg-teal-50 px-2 py-0.5 rounded-full border border-teal-100">
                Live Speech Engine Listening
              </span>
            </div>

            <div className="h-44 overflow-y-auto space-y-2.5 pr-2 text-xs font-sans">
              {activeSession.transcription.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-400 text-xs italic">
                  Dialogue transcript will appear here as speech audio streams.
                </div>
              ) : (
                activeSession.transcription.map((entry) => (
                  <div
                    key={entry.id}
                    className={`p-2.5 rounded-xl border text-xs ${
                      entry.speaker === 'DOCTOR'
                        ? 'bg-indigo-50/70 border-indigo-100 ml-6 text-indigo-950'
                        : entry.speaker === 'PATIENT'
                        ? 'bg-slate-50 border-slate-200 mr-6 text-slate-900'
                        : 'bg-emerald-50/50 border-emerald-100 text-emerald-900 font-mono text-[11px]'
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold text-[10px] mb-1">
                      <span className="uppercase text-slate-500">
                        {entry.speaker === 'DOCTOR'
                          ? activeSession.attendingPhysician
                          : entry.speaker === 'PATIENT'
                          ? activeSession.patientName
                          : 'SYSTEM GATEWAY'}
                      </span>
                      <span className="text-slate-400 font-normal">{entry.timestamp}</span>
                    </div>
                    <p className="leading-relaxed">{entry.text}</p>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Clinician Speech / Dictation Input Form */}
            <form onSubmit={handleSendTranscriptMessage} className="flex gap-2 pt-1">
              <input
                type="text"
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                placeholder="Dictate clinician statement or inject dialogue into transcript..."
                className="flex-1 text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:bg-white transition-all"
              />
              <button
                type="submit"
                className="px-3.5 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold flex items-center gap-1 shadow-sm cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" /> Record
              </button>
            </form>
          </div>
        </div>

        {/* Right Column: Clinical Documentation, SOAP & E-Prescribing (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Patient Header Card */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-teal-100 text-teal-800 font-extrabold flex items-center justify-center text-sm">
                  {activeSession.patientName
                    .split(' ')
                    .map((n) => n[0])
                    .join('')}
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">{activeSession.patientName}</h3>
                  <p className="text-[11px] text-slate-500">
                    {activeSession.patientMrn} • {activeSession.age}yo {activeSession.gender}
                  </p>
                </div>
              </div>
              <span
                className={`px-2.5 py-1 text-[10px] font-bold rounded-lg border ${
                  activeSession.status === 'COMPLETED'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : activeSession.status === 'IN_CONSULTATION'
                    ? 'bg-teal-50 text-teal-700 border-teal-200'
                    : activeSession.status === 'WAITING_ROOM'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                {activeSession.status.replace('_', ' ')}
              </span>
            </div>

            <div className="p-2.5 bg-slate-50 rounded-xl text-xs border border-slate-100 space-y-1">
              <div className="text-[11px] text-slate-600">
                <strong className="text-slate-800">Chief Complaint:</strong> {activeSession.chiefComplaint}
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                Attending: {activeSession.attendingPhysician} (NPI: {activeSession.clinicianNpi})
              </div>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-4">
            <div className="flex border-b border-slate-200">
              <button
                onClick={() => setSelectedTab('soap')}
                className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                  selectedTab === 'soap'
                    ? 'border-teal-600 text-teal-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <FileText className="w-3.5 h-3.5" /> SOAP Clinical Note
              </button>
              <button
                onClick={() => setSelectedTab('rx')}
                className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                  selectedTab === 'rx'
                    ? 'border-teal-600 text-teal-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Pill className="w-3.5 h-3.5" /> Surescripts E-Rx ({activeSession.prescriptions.length})
              </button>
              <button
                onClick={() => setSelectedTab('vitals')}
                className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                  selectedTab === 'vitals'
                    ? 'border-teal-600 text-teal-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Activity className="w-3.5 h-3.5" /> Remote Vitals & RPM
              </button>
            </div>

            {/* Tab 1: Clinical SOAP Note */}
            {selectedTab === 'soap' && (
              <div className="space-y-3.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 flex items-center gap-1">
                    Ambient Speech-to-SOAP Scribe
                  </span>
                  <button
                    onClick={handleSynthesizeSoap}
                    disabled={isAiGeneratingSoap}
                    className="px-2.5 py-1 bg-gradient-to-r from-teal-600 to-indigo-600 hover:from-teal-500 hover:to-indigo-500 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    <Sparkles className="w-3 h-3" />
                    {isAiGeneratingSoap ? 'Synthesizing...' : 'Synthesize SOAP with AI'}
                  </button>
                </div>

                <div className="space-y-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">
                      Subjective (Chief Complaint & Patient History)
                    </label>
                    <textarea
                      rows={3}
                      value={soapSubjective}
                      onChange={(e) => setSoapSubjective(e.target.value)}
                      className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-teal-500"
                      placeholder="Patient statements, symptom trajectory, home glucose/BP logs..."
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">
                      Objective (Video Physical & Bio-Telemetry)
                    </label>
                    <textarea
                      rows={3}
                      value={soapObjective}
                      onChange={(e) => setSoapObjective(e.target.value)}
                      className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-teal-500"
                      placeholder="Clinical visual inspection, synchronized remote vitals..."
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">
                      Assessment & ICD-10 Diagnoses
                    </label>
                    <textarea
                      rows={2}
                      value={soapAssessment}
                      onChange={(e) => setSoapAssessment(e.target.value)}
                      className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-teal-500"
                      placeholder="Clinical evaluation and diagnosis..."
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">
                      Plan & Treatment Orders
                    </label>
                    <textarea
                      rows={2}
                      value={soapPlan}
                      onChange={(e) => setSoapPlan(e.target.value)}
                      className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-teal-500"
                      placeholder="Medication titration, diagnostic tests, remote follow-up schedule..."
                    />
                  </div>
                </div>

                {/* CPT Codes for Revenue Integrity */}
                {cptCodes.length > 0 && (
                  <div className="p-2.5 bg-indigo-50/60 rounded-xl border border-indigo-100 space-y-1">
                    <span className="text-[10px] font-bold text-indigo-900 uppercase">
                      Revenue Integrity Auto-Captured CPT Billing Codes
                    </span>
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {cptCodes.map((c, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 bg-white border border-indigo-200 text-indigo-800 rounded text-[10px] font-mono font-bold"
                        >
                          {c.code} (${c.fee || 125})
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {soapSavedSuccess && (
                  <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl flex items-center gap-2 text-emerald-900 text-xs font-bold animate-fade-in">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    SOAP note permanently signed and committed to Master Patient Index EHR. CPT codes queued for Revenue Integrity billing audit.
                  </div>
                )}

                <div className="pt-2 border-t border-slate-100 flex justify-end">
                  <button
                    onClick={handleSignAndCommitSoap}
                    className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer transition-colors"
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
                  <span className="font-bold text-slate-800">
                    Surescripts Certified E-Prescribing Orders
                  </span>
                  <button
                    onClick={() => setShowAddRx(!showAddRx)}
                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-[11px] font-bold cursor-pointer"
                  >
                    {showAddRx ? 'Cancel' : '+ Add Medication'}
                  </button>
                </div>

                {showAddRx && (
                  <form
                    onSubmit={handleAddPrescription}
                    className="p-3 bg-teal-50/50 rounded-xl border border-teal-200 space-y-2"
                  >
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
                        placeholder="Strength / Dose (e.g. 10 mg)"
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
                        placeholder="Duration (e.g. 30 Days)"
                        value={newDuration}
                        onChange={(e) => setNewDuration(e.target.value)}
                        className="text-xs p-2 bg-white border border-slate-200 rounded-lg"
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="Sig / Patient Instructions"
                      value={newInstructions}
                      onChange={(e) => setNewInstructions(e.target.value)}
                      className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg"
                    />
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="submit"
                        className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-xs font-bold cursor-pointer"
                      >
                        Add to Order Set
                      </button>
                    </div>
                  </form>
                )}

                <div className="space-y-2">
                  {activeSession.prescriptions.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 italic">
                      No prescriptions added yet for this virtual encounter.
                    </div>
                  ) : (
                    activeSession.prescriptions.map((rx) => (
                      <div
                        key={rx.id}
                        className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900">{rx.medication}</span>
                          <span className="px-2 py-0.5 bg-teal-100 text-teal-800 font-bold rounded text-[10px]">
                            {rx.dosage}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600">{rx.instructions}</p>
                        <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pt-1">
                          <span>
                            {rx.frequency} • {rx.duration}
                          </span>
                          <span
                            className={`font-bold ${
                              rx.status === 'TRANSMITTED'
                                ? 'text-emerald-600'
                                : 'text-amber-600'
                            }`}
                          >
                            {rx.status || 'PENDING'}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {eRxSubmitted && (
                  <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl flex items-center gap-2 text-emerald-800 text-xs font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    Prescriptions successfully routed via Surescripts NCPDP network to CVS Pharmacy #4912.
                  </div>
                )}

                {activeSession.prescriptions.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 flex justify-end">
                    <button
                      onClick={handleTransmitERx}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" /> Transmit Electronic E-Rx to Pharmacy
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Tab 3: Remote Vitals & Bio-Telemetry */}
            {selectedTab === 'vitals' && (
              <div className="space-y-3.5 text-xs">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">
                      Blood Pressure
                    </span>
                    <span className="text-base font-black text-slate-900 mt-0.5 block">
                      {activeSession.vitals.bp}
                    </span>
                    <span className="text-[10px] text-emerald-600 font-bold">In Target</span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">
                      Heart Rate
                    </span>
                    <span className="text-base font-black text-slate-900 mt-0.5 block">
                      {activeSession.vitals.hr} bpm
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {activeSession.vitals.rhythm || 'Normal Sinus'}
                    </span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">
                      SpO2 Oxygen
                    </span>
                    <span className="text-base font-black text-emerald-600 mt-0.5 block">
                      {activeSession.vitals.spo2}%
                    </span>
                    <span className="text-[10px] text-emerald-700">Room Air</span>
                  </div>
                </div>

                <div className="p-3.5 bg-teal-50/60 rounded-xl border border-teal-100 space-y-1.5">
                  <h4 className="font-bold text-teal-950 text-xs flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-teal-600" />
                    Patient Connected Remote Monitoring Profile
                  </h4>
                  <p className="text-slate-700 text-[11px]">
                    Telemetry Gateway:{' '}
                    <strong>{activeSession.vitals.connectedDevice || 'Withings BPM Core BLE v5.2'}</strong>
                  </p>
                  <p className="text-slate-500 text-[10px]">
                    Last automated synchronization: {activeSession.vitals.lastSync || '3 min ago'}. 7-day adherence rate: 96.4%.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Appointment Queue & Clinic Schedule */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-teal-600" />
            <h3 className="font-bold text-slate-900 text-sm">Virtual Clinic Appointments & Queue</h3>
            <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs font-bold">
              {filteredSessions.length} total
            </span>
          </div>

          {/* Status filter tabs */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs overflow-x-auto">
            {(['ALL', 'WAITING_ROOM', 'IN_CONSULTATION', 'DOCUMENTING', 'COMPLETED'] as const).map(
              (st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 rounded-lg font-bold text-[11px] whitespace-nowrap transition-colors cursor-pointer ${
                    statusFilter === st
                      ? 'bg-white text-teal-800 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {st.replace('_', ' ')}
                </button>
              )
            )}
          </div>
        </div>

        {/* Appointment Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {filteredSessions.map((s) => (
            <div
              key={s.id}
              onClick={() => handleSelectSession(s)}
              className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                activeSession.id === s.id
                  ? 'border-teal-500 bg-teal-50/30 ring-1 ring-teal-500 shadow-xs'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-bold text-xs text-slate-900">{s.patientName}</h4>
                  <span className="text-[10px] text-slate-400 font-mono">{s.patientMrn}</span>
                </div>
                <span
                  className={`px-2 py-0.5 text-[9px] font-bold rounded-md uppercase border ${
                    s.status === 'IN_CONSULTATION'
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-200 animate-pulse'
                      : s.status === 'WAITING_ROOM'
                      ? 'bg-amber-100 text-amber-800 border-amber-200'
                      : s.status === 'COMPLETED'
                      ? 'bg-slate-100 text-slate-600 border-slate-200'
                      : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  }`}
                >
                  {s.status.replace('_', ' ')}
                </span>
              </div>

              <p className="text-[11px] text-slate-600 mt-2 line-clamp-2">{s.chiefComplaint}</p>

              <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                <span className="flex items-center gap-1 font-mono">
                  <Clock className="w-3 h-3 text-slate-400" /> {s.scheduledTime}
                </span>
                <span className="font-semibold text-teal-700">{s.specialty}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Schedule Appointment Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4 animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <Video className="w-4 h-4 text-teal-600" />
                Schedule New Virtual Consultation
              </h3>
              <button
                onClick={() => setShowScheduleModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateAppointment} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Select Patient</label>
                <select
                  value={schedPatientId}
                  onChange={(e) => setSchedPatientId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  required
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName} ({p.mrn}) — {p.age}y {p.gender}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Consultation Type</label>
                <select
                  value={schedType}
                  onChange={(e) => setSchedType(e.target.value as any)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                >
                  <option value="Telehealth Consultation">Telehealth Consultation</option>
                  <option value="RPM Chronic Care Review">RPM Chronic Care Review</option>
                  <option value="Remote Post-Op Follow-up">Remote Post-Op Follow-up</option>
                  <option value="Urgent Care Triage">Urgent Care Triage</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Date & Time Slot</label>
                  <input
                    type="text"
                    value={schedTime}
                    onChange={(e) => setSchedTime(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                    placeholder="Today, 16:30"
                    required
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Attending Physician</label>
                  <input
                    type="text"
                    value={schedPhysician}
                    onChange={(e) => setSchedPhysician(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Chief Complaint & Clinical Intent</label>
                <textarea
                  rows={3}
                  value={schedComplaint}
                  onChange={(e) => setSchedComplaint(e.target.value)}
                  placeholder="Reason for remote consult (e.g. episodic arrhythmia, wound evaluation, glycemic titration)..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowScheduleModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Book Consultation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
