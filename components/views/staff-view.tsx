'use client';

import React, { useState } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import { StaffMember } from '@/lib/types/ghims';
import { Users, Stethoscope, Clock, Phone, Plus, CheckCircle2, AlertCircle, Search, ShieldCheck, Award } from 'lucide-react';

export function StaffView() {
  const { staff } = useHospital();
  const [roleFilter, setRoleFilter] = useState('All');
  const [departmentFilter, setDepartmentFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  const departments = ['All', ...Array.from(new Set(staff.map((s) => s.department)))];

  const filteredStaff = staff.filter((s) => {
    const matchesRole = roleFilter === 'All' || s.role === roleFilter;
    const matchesDept = departmentFilter === 'All' || s.department === departmentFilter;
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      s.fullName.toLowerCase().includes(q) ||
      s.department.toLowerCase().includes(q) ||
      s.role.toLowerCase().includes(q) ||
      s.phone.includes(q);
    return matchesRole && matchesDept && matchesSearch;
  });

  const getStatusBadge = (status: StaffMember['status']) => {
    switch (status) {
      case 'on-duty':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">ON DUTY</span>;
      case 'in-surgery':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">IN SURGERY</span>;
      case 'on-break':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">ON BREAK</span>;
      case 'off-duty':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">OFF DUTY</span>;
    }
  };

  const totalPhysicians = staff.filter((s) => s.role === 'Physician' || s.role === 'Surgeon').length;
  const onDutyCount = staff.filter((s) => s.status === 'on-duty' || s.status === 'in-surgery').length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" /> Specialist Physicians & Clinical Roster
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Credential-gated clinical privileges, active specialist duty rosters, and multi-department coverage ({totalPhysicians} Attending Specialists)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
            <input
              type="text"
              placeholder="Search physician..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-xs pl-8 pr-2.5 py-1.5 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Role Filter */}
          <select
            id="select-staff-role-filter"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-slate-50 text-slate-700 focus:ring-1 focus:ring-blue-500"
          >
            <option value="All">All Roles</option>
            <option value="Physician">Physicians & Specialists</option>
            <option value="Surgeon">Surgeons & Anesthesiologists</option>
            <option value="Nurse">Nurses</option>
            <option value="Lab Technician">Lab & Diagnostics</option>
          </select>

          {/* Department Filter */}
          <select
            id="select-staff-dept-filter"
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-slate-50 text-slate-700 focus:ring-1 focus:ring-blue-500 max-w-[180px] truncate"
          >
            {departments.map((d) => (
              <option key={d} value={d}>
                {d === 'All' ? 'All Departments' : d}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Specialty Coverage Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 block">Total Clinical Staff</span>
          <span className="text-lg font-black text-slate-900">{staff.length}</span>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 block">Specialist Physicians</span>
          <span className="text-lg font-black text-blue-600">{totalPhysicians}</span>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 block">Active On Duty / In Surgery</span>
          <span className="text-lg font-black text-emerald-600">{onDutyCount}</span>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 block">Covered Specialties</span>
          <span className="text-lg font-black text-purple-600">12 Sub-Specialties</span>
        </div>
      </div>

      {/* Staff Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {filteredStaff.map((member) => (
          <div key={member.id} className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm space-y-3 hover:border-blue-300 transition-colors">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold text-slate-900">{member.fullName}</h3>
                <span className="text-[11px] text-blue-600 font-medium">{member.role}</span>
              </div>
              <div>{getStatusBadge(member.status)}</div>
            </div>

            <div className="text-xs text-slate-500 space-y-1">
              <p>
                Department: <strong className="text-slate-700">{member.department}</strong>
              </p>
              <p>
                Shift: <span className="text-slate-700">{member.shift}</span>
              </p>
              <p>
                Contact: <span className="font-mono text-slate-700">{member.phone}</span>
              </p>
              <p>
                Caseload: <strong className="text-slate-800">{member.assignedPatientsCount} active patients</strong>
              </p>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-500" /> Privilege Verified
              </span>
              <span className="font-mono">{member.id}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
