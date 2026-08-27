'use client';

import React, { useState } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import {
  Cpu,
  Send,
  Code,
  CheckCircle2,
  AlertCircle,
  FileCode,
  ArrowRightLeft,
  Server,
  Layers,
  Sparkles,
  Copy,
  Check,
} from 'lucide-react';
import { Hl7Message, FhirResource } from '@/lib/types/ghims';

export function OrdersInteropView() {
  const { hl7Messages, dispatchHl7Message, patients } = useHospital();
  const [selectedMsgId, setSelectedMsgId] = useState<string>(hl7Messages[0]?.id || 'hl7-801');
  const [simType, setSimType] = useState<'ADT^A01' | 'ORM^O01' | 'ORU^R01'>('ADT^A01');
  const [activeTab, setActiveTab] = useState<'hl7' | 'fhir'>('hl7');
  const [copied, setCopied] = useState<boolean>(false);

  const selectedMsg = hl7Messages.find(m => m.id === selectedMsgId) || hl7Messages[0];

  const handleSimulateDispatch = () => {
    const patient = patients[0];
    let payload = '';
    let summary = '';

    if (simType === 'ADT^A01') {
      payload = `MSH|^~\\&|GHIMS_ADMISSION|METRO_MEMORIAL|CORE_HIS|HOSPITAL|${Date.now()}||ADT^A01|MSG_${Date.now()}|P|2.5\rPID|1||${patient.mrn}^^^GHIMS||${patient.fullName.replace(' ', '^')}||19820414|F\rPV1|1|I|ICU^101^01|Cardiology|||Dr. Jenkins^Sarah`;
      summary = `Simulated Inpatient Admission event for ${patient.fullName} (MRN: ${patient.mrn})`;
    } else if (simType === 'ORM^O01') {
      payload = `MSH|^~\\&|GHIMS_ORDER|METRO_MEMORIAL|ROCHE_LIS|LAB|${Date.now()}||ORM^O01|MSG_${Date.now()}|P|2.5\rPID|1||${patient.mrn}^^^GHIMS||${patient.fullName.replace(' ', '^')}\rORC|NW|ORD_${Date.now()}|||SC\rOBR|1|ORD_${Date.now()}||93306^Echocardiography 2D^CPT`;
      summary = `Dispatched Diagnostic Order for Echocardiography 2D (CPT 93306)`;
    } else {
      payload = `MSH|^~\\&|ROCHE_LIS|LAB|GHIMS_EHR|METRO_MEMORIAL|${Date.now()}||ORU^R01|MSG_${Date.now()}|P|2.5\rPID|1||${patient.mrn}^^^GHIMS||${patient.fullName.replace(' ', '^')}\rOBX|1|NM|TROP_I^Troponin I||0.042|ng/mL|<0.014|H`;
      summary = `Received Lab Observation Result: Troponin I = 0.042 ng/mL (HIGH)`;
    }

    dispatchHl7Message({
      type: simType,
      sendingApp: 'GHIMS_CORE',
      receivingApp: 'LEGACY_HIS_LIS',
      patientMrn: patient.mrn,
      patientName: patient.fullName,
      rawPayload: payload,
      parsedSummary: summary,
    });
  };

  const sampleFhirResource: FhirResource = {
    resourceType: 'Encounter',
    id: 'enc-201',
    status: 'in-progress',
    subject: { reference: 'Patient/GH-2026-9812', display: 'Elena Rostova' },
    date: '2026-08-10',
    code: {
      text: 'Cardiology Inpatient ICU Care',
      coding: [{ system: 'http://snomed.info/sct', code: '405623001', display: 'Acute coronary syndrome care' }]
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
              <Cpu className="w-4 h-4" />
            </span>
            <h1 className="text-lg font-bold text-slate-900">Interoperability & Order Routing Hub</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Real-time HL7 v2 pipe-delimited parser & FHIR R4 JSON standard resource mapper for legacy hospital hardware
          </p>
        </div>

        <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-xl">
          <button
            onClick={() => setActiveTab('hl7')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'hl7' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600'
            }`}
          >
            HL7 v2 Message Stream ({hl7Messages.length})
          </button>
          <button
            onClick={() => setActiveTab('fhir')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'fhir' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600'
            }`}
          >
            FHIR R4 JSON Bundle
          </button>
        </div>
      </div>

      {activeTab === 'hl7' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Message Log List & Dispatcher */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h2 className="text-sm font-bold text-slate-900">HL7 v2 Message Ledger</h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                  Engine Online
                </span>
              </div>

              <div className="space-y-2.5 max-h-96 overflow-y-auto">
                {hl7Messages.map((msg) => (
                  <div
                    key={msg.id}
                    onClick={() => setSelectedMsgId(msg.id)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer ${
                      selectedMsgId === msg.id
                        ? 'bg-blue-50/80 border-blue-300 ring-2 ring-blue-500/20'
                        : 'bg-slate-50/60 border-slate-200 hover:bg-slate-100/70'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded font-mono font-bold text-xs bg-slate-900 text-white">
                        {msg.type}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">{msg.timestamp}</span>
                    </div>

                    <p className="text-xs font-bold text-slate-900 mt-2">{msg.parsedSummary}</p>

                    <div className="flex items-center justify-between text-[10px] text-slate-500 mt-2 pt-2 border-t border-slate-200/60">
                      <span>Sender: <strong className="text-slate-700">{msg.sendingApp}</strong></span>
                      <span>Receiver: <strong className="text-slate-700">{msg.receivingApp}</strong></span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Message Simulator Box */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider block">
                  Simulate Legacy Machine Event
                </span>
                <div className="flex items-center gap-2">
                  <select
                    value={simType}
                    onChange={(e) => setSimType(e.target.value as any)}
                    className="text-xs font-bold bg-white border border-slate-200 rounded-lg p-2 flex-1 text-slate-800"
                  >
                    <option value="ADT^A01">ADT^A01 (Inpatient Admission)</option>
                    <option value="ORM^O01">ORM^O01 (Order Entry Lab/Rad)</option>
                    <option value="ORU^R01">ORU^R01 (Observation Results)</option>
                  </select>
                  <button
                    onClick={handleSimulateDispatch}
                    className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1 shadow-xs transition-all cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" /> Dispatch
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Message Payload Inspector */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider block">
                    Message Inspector
                  </span>
                  <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                    {selectedMsg?.type} Payload
                  </h3>
                </div>

                <button
                  onClick={() => {
                    navigator.clipboard.writeText(selectedMsg?.rawPayload || '');
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy Raw'}
                </button>
              </div>

              {/* Raw Delimited Box */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">Raw Pipe-Delimited HL7 Segment:</label>
                <pre className="p-3.5 bg-slate-950 text-emerald-400 font-mono text-xs rounded-xl overflow-x-auto whitespace-pre-wrap leading-relaxed border border-slate-800">
                  {selectedMsg?.rawPayload}
                </pre>
              </div>

              {/* Parsed Structure Explanation */}
              <div className="space-y-2 pt-2">
                <label className="text-xs font-bold text-slate-700">Parsed Clinical Interpretation:</label>
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 space-y-1.5">
                  <div className="flex justify-between border-b border-slate-200/60 pb-1">
                    <span className="font-semibold text-slate-500">Summary:</span>
                    <strong className="text-slate-900">{selectedMsg?.parsedSummary}</strong>
                  </div>
                  <div className="flex justify-between border-b border-slate-200/60 pb-1">
                    <span className="font-semibold text-slate-500">Target MRN:</span>
                    <span className="font-mono font-bold text-slate-800">{selectedMsg?.patientMrn}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-500">Routing Protocol:</span>
                    <span className="font-semibold text-emerald-700">TCP/MLLP (Port 2575 Direct Socket)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'fhir' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900">HL7 FHIR R4 Resource Bundle Standard</h2>
            <p className="text-xs text-slate-500">
              Interoperable JSON representation compatible with SMART-on-FHIR, Apple Health, and regional national exchanges
            </p>
          </div>

          <pre className="p-4 bg-slate-950 text-blue-300 font-mono text-xs rounded-xl overflow-x-auto leading-relaxed border border-slate-800">
            {JSON.stringify(sampleFhirResource, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
