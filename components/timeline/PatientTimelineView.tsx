'use client';

import React, { useState } from 'react';
import { PatientTimelineProjection, TimelineCategory } from '@/types/patient-timeline';
import {
  Activity,
  HeartPulse,
  Stethoscope,
  FlaskConical,
  Pill,
  Receipt,
  UserCheck,
  Clock,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Filter,
  FileCheck,
} from 'lucide-react';

interface PatientTimelineViewProps {
  timelineEvents: PatientTimelineProjection[];
  patientName?: string;
  patientMrn?: string;
}

export function PatientTimelineView({
  timelineEvents,
  patientName,
  patientMrn,
}: PatientTimelineViewProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [expandedEventIds, setExpandedEventIds] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) => {
    setExpandedEventIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const filteredEvents = timelineEvents.filter((ev) => {
    if (selectedCategory === 'ALL') return true;
    return ev.category === selectedCategory;
  });

  const getCategoryConfig = (category: TimelineCategory) => {
    switch (category) {
      case 'REGISTRATION':
        return {
          icon: <UserCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />,
          bgColor: 'bg-blue-50 dark:bg-blue-950/60',
          borderColor: 'border-blue-200 dark:border-blue-800',
          tagText: 'Registration',
        };
      case 'TRIAGE':
        return {
          icon: <HeartPulse className="w-4 h-4 text-amber-600 dark:text-amber-400" />,
          bgColor: 'bg-amber-50 dark:bg-amber-950/60',
          borderColor: 'border-amber-200 dark:border-amber-800',
          tagText: 'Triage / Vitals',
        };
      case 'CONSULTATION':
        return {
          icon: <Stethoscope className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />,
          bgColor: 'bg-emerald-50 dark:bg-emerald-950/60',
          borderColor: 'border-emerald-200 dark:border-emerald-800',
          tagText: 'Physician Consult',
        };
      case 'DIAGNOSTICS':
        return {
          icon: <FlaskConical className="w-4 h-4 text-purple-600 dark:text-purple-400" />,
          bgColor: 'bg-purple-50 dark:bg-purple-950/60',
          borderColor: 'border-purple-200 dark:border-purple-800',
          tagText: 'Lab & Diagnostics',
        };
      case 'PHARMACY':
        return {
          icon: <Pill className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />,
          bgColor: 'bg-cyan-50 dark:bg-cyan-950/60',
          borderColor: 'border-cyan-200 dark:border-cyan-800',
          tagText: 'Pharmacy Dispense',
        };
      case 'BILLING':
        return {
          icon: <Receipt className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />,
          bgColor: 'bg-indigo-50 dark:bg-indigo-950/60',
          borderColor: 'border-indigo-200 dark:border-indigo-800',
          tagText: 'Billing & Ledger',
        };
      default:
        return {
          icon: <Activity className="w-4 h-4 text-slate-600 dark:text-slate-400" />,
          bgColor: 'bg-slate-50 dark:bg-slate-800',
          borderColor: 'border-slate-200 dark:border-slate-700',
          tagText: 'Event',
        };
    }
  };

  return (
    <div
      id="patient-timeline-projection"
      className="w-full bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs flex flex-col gap-5"
    >
      {/* Header with Title and Category Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Longitudinal Care Timeline Projection
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {patientName ? (
                  <>
                    Showing chronological encounter milestones for{' '}
                    <strong className="text-slate-700 dark:text-slate-200">{patientName}</strong>{' '}
                    ({patientMrn})
                  </>
                ) : (
                  'Real-time stream of clinical transitions and medical orders'
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Filter Badges */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-400 font-medium mr-1 flex items-center gap-1">
            <Filter className="w-3 h-3" />
            Category:
          </span>
          {[
            'ALL',
            'REGISTRATION',
            'TRIAGE',
            'CONSULTATION',
            'DIAGNOSTICS',
            'PHARMACY',
            'BILLING',
          ].map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                selectedCategory === cat
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {cat === 'ALL' ? 'All Milestones' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* Vertical Timeline Thread */}
      {filteredEvents.length === 0 ? (
        <div className="py-12 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
          <FileCheck className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
            No timeline milestones recorded for this filter category.
          </p>
        </div>
      ) : (
        <div className="relative pl-6 sm:pl-8 before:content-[''] before:absolute before:left-3 sm:before:left-4 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800 flex flex-col gap-6">
          {filteredEvents.map((event) => {
            const config = getCategoryConfig(event.category);
            const isExpanded = !!expandedEventIds[event.id];
            const eventTime = new Date(event.timestamp);

            return (
              <div
                key={event.id}
                id={`timeline-event-${event.id}`}
                className="relative flex flex-col gap-2 group"
              >
                {/* Node icon on the line */}
                <div
                  className={`absolute -left-6 sm:-left-8 top-1 w-6 h-6 rounded-full ${config.bgColor} border ${config.borderColor} flex items-center justify-center shadow-xs shrink-0 z-10`}
                >
                  {config.icon}
                </div>

                {/* Milestone Card */}
                <div className="bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 rounded-xl p-4 hover:bg-white dark:hover:bg-slate-800/80 transition-all flex flex-col gap-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${config.bgColor} ${config.borderColor} border text-slate-800 dark:text-slate-200`}
                      >
                        {config.tagText}
                      </span>
                      <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                        {event.title}
                      </h4>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-slate-400 font-medium">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{eventTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                      <span>•</span>
                      <span>{eventTime.toLocaleDateString()}</span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {event.summary}
                  </p>

                  {/* Actor and Metadata toggle */}
                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-200/60 dark:border-slate-800/70 text-[11px]">
                    <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                      <UserCheck className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        Signed by:{' '}
                        <strong className="text-slate-700 dark:text-slate-300">
                          {event.actorName}
                        </strong>{' '}
                        ({event.actorRole || 'authorized'})
                      </span>
                    </div>

                    {event.metadata && Object.keys(event.metadata).length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(event.id)}
                        className="text-purple-600 dark:text-purple-400 hover:underline font-semibold flex items-center gap-1"
                      >
                        <span>{isExpanded ? 'Hide Payload' : 'View Payload Details'}</span>
                        {isExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>

                  {/* Expandable JSON / Metadata block */}
                  {isExpanded && event.metadata && (
                    <div className="mt-2 p-3 bg-slate-900 text-slate-100 rounded-lg text-[11px] font-mono overflow-x-auto border border-slate-800">
                      <pre className="text-slate-300">{JSON.stringify(event.metadata, null, 2)}</pre>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
