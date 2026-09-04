'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/firebase/auth-context';
import { useHospital } from '@/lib/context/hospital-context';
import {
  listDriveSpreadsheets,
  getSpreadsheetMetadata,
  getSpreadsheetValues,
  createHospitalSpreadsheet,
  appendSpreadsheetRows,
  GoogleDriveFile,
  SpreadsheetMetadata,
} from '@/lib/google/sheets-service';
import {
  FileSpreadsheet,
  Plus,
  RefreshCw,
  ExternalLink,
  Table,
  UploadCloud,
  DownloadCloud,
  CheckCircle2,
  AlertCircle,
  Search,
  FileText,
  BedDouble,
  DollarSign,
  Users,
  Stethoscope,
  ChevronRight,
  Sparkles,
  ShieldCheck,
  Calendar,
  Layers,
  ArrowRight,
  Database,
} from 'lucide-react';

export function GoogleSheetsView() {
  const { user, accessToken, signInWithGoogle } = useAuth();
  const { patients, beds, mismatches, opdQueue, stats } = useHospital();

  // State
  const [spreadsheets, setSpreadsheets] = useState<GoogleDriveFile[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Selected spreadsheet details
  const [selectedSheetId, setSelectedSheetId] = useState<string>('');
  const [selectedMetadata, setSelectedMetadata] = useState<SpreadsheetMetadata | null>(null);
  const [selectedTab, setSelectedTab] = useState<string>('');
  const [sheetValues, setSheetValues] = useState<string[][]>([]);
  const [loadingValues, setLoadingValues] = useState(false);
  const [valuesError, setValuesError] = useState<string | null>(null);

  // Manual Spreadsheet ID / URL input
  const [customSheetInput, setCustomSheetInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Confirmation Modal State (Mandatory for mutating Google Workspace data)
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    actionType: 'create_patient_sheet' | 'create_census_sheet' | 'create_billing_sheet' | 'create_opd_sheet' | 'append_to_current';
    payload?: any;
  } | null>(null);

  const [executingAction, setExecutingAction] = useState(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<{ title: string; url?: string } | null>(null);

  const handleConnectGoogle = async () => {
    try {
      await signInWithGoogle();
    } catch (err: any) {
      console.warn('Google connection status:', err?.message || err);
    }
  };

  // Handle spreadsheet selection
  const handleSelectSheet = React.useCallback(async (sheetId: string) => {
    if (!accessToken || !sheetId) return;
    setSelectedSheetId(sheetId);
    setLoadingValues(true);
    setValuesError(null);
    try {
      const meta = await getSpreadsheetMetadata(accessToken, sheetId);
      setSelectedMetadata(meta);
      const firstTab = meta.sheets?.[0]?.properties?.title || 'Sheet1';
      setSelectedTab(firstTab);

      // Read values from first tab
      const data = await getSpreadsheetValues(accessToken, sheetId, `'${firstTab}'!A1:Z50`);
      setSheetValues(data.values || []);
    } catch (err: any) {
      console.error('Error loading spreadsheet metadata/values:', err);
      setValuesError(err.message || 'Failed to read spreadsheet contents');
    } finally {
      setLoadingValues(false);
    }
  }, [accessToken]);

  // Fetch list of spreadsheets from user's Google Drive when token is available
  const fetchDriveSheets = React.useCallback(async () => {
    if (!accessToken) return;
    setLoadingList(true);
    setListError(null);
    try {
      const files = await listDriveSpreadsheets(accessToken);
      setSpreadsheets(files);
      if (files.length > 0 && !selectedSheetId) {
        handleSelectSheet(files[0].id);
      }
    } catch (err: any) {
      console.error('Error fetching Google Drive spreadsheets:', err);
      setListError(err.message || 'Failed to load Google Drive spreadsheets');
    } finally {
      setLoadingList(false);
    }
  }, [accessToken, selectedSheetId, handleSelectSheet]);

  useEffect(() => {
    if (accessToken) {
      fetchDriveSheets();
    }
  }, [accessToken, fetchDriveSheets]);

  // Change active tab inside selected spreadsheet
  const handleTabChange = async (tabName: string) => {
    if (!accessToken || !selectedSheetId) return;
    setSelectedTab(tabName);
    setLoadingValues(true);
    setValuesError(null);
    try {
      const data = await getSpreadsheetValues(accessToken, selectedSheetId, `'${tabName}'!A1:Z50`);
      setSheetValues(data.values || []);
    } catch (err: any) {
      setValuesError(err.message || 'Failed to load tab data');
    } finally {
      setLoadingValues(false);
    }
  };

  // Connect manual URL or ID
  const handleConnectCustomSheet = () => {
    let id = customSheetInput.trim();
    if (!id) return;
    // Extract ID if full URL is pasted
    const match = id.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) {
      id = match[1];
    }
    handleSelectSheet(id);
    setCustomSheetInput('');
  };

  // Export handlers with Confirmation Dialog
  const triggerExportConfirmation = (
    type: 'create_patient_sheet' | 'create_census_sheet' | 'create_billing_sheet' | 'create_opd_sheet'
  ) => {
    if (type === 'create_patient_sheet') {
      setConfirmModal({
        isOpen: true,
        title: 'Export Patient Master Index (MPI) to Google Sheets',
        description: `Create a new formatted Google Spreadsheet in your Google Drive containing ${patients.length} patient records with MRNs, demographics, allergies, active encounters, and attending physicians.`,
        actionType: type,
      });
    } else if (type === 'create_census_sheet') {
      setConfirmModal({
        isOpen: true,
        title: 'Export Inpatient Bed Census to Google Sheets',
        description: `Create a new Google Spreadsheet containing real-time status of all ${beds.length} hospital beds across ICU, General, Emergency, Surgery, and Maternity wards.`,
        actionType: type,
      });
    } else if (type === 'create_billing_sheet') {
      setConfirmModal({
        isOpen: true,
        title: 'Export Universal Billing & Revenue Audit Ledger',
        description: `Create a new Google Spreadsheet containing ${mismatches.length} detected revenue leakage audit items with loss projections and reconciliation statuses.`,
        actionType: type,
      });
    } else if (type === 'create_opd_sheet') {
      setConfirmModal({
        isOpen: true,
        title: 'Export OPD Triage & Consultation Queue',
        description: `Create a new Google Spreadsheet containing ${opdQueue.length} outpatient consultation tokens and wait-time statistics.`,
        actionType: type,
      });
    }
  };

  // Execute Confirmed Mutation
  const handleExecuteConfirmedAction = async () => {
    if (!confirmModal || !accessToken) return;
    setExecutingAction(true);
    setActionSuccessMessage(null);

    try {
      if (confirmModal.actionType === 'create_patient_sheet') {
        const title = `G-HIMS Patient Master Index (${new Date().toLocaleDateString()})`;
        const headers = ['MRN', 'Full Name', 'DOB', 'Age', 'Gender', 'Blood Group', 'Allergies', 'Chronic Conditions', 'Active Bed', 'Active Encounter', 'Registered Date'];
        const rows = patients.map((p) => [
          p.mrn,
          p.fullName,
          p.dateOfBirth,
          p.age,
          p.gender,
          p.bloodGroup,
          p.allergies.join('; '),
          p.chronicConditions.join('; '),
          p.activeBedId || 'Outpatient',
          p.activeEncounterId || 'None',
          p.registeredAt,
        ]);

        const result = await createHospitalSpreadsheet(accessToken, title, [
          { title: 'Patient Registry', headers, rows },
        ]);
        setActionSuccessMessage({ title: 'Patient Registry exported to Google Sheets!', url: result.spreadsheetUrl });
        await fetchDriveSheets();
        handleSelectSheet(result.spreadsheetId);
      } else if (confirmModal.actionType === 'create_census_sheet') {
        const title = `G-HIMS Inpatient Bed Census (${new Date().toLocaleDateString()})`;
        const headers = ['Bed Number', 'Ward', 'Room', 'Status', 'Patient ID', 'Patient Name', 'Admission Date', 'Attending Doctor', 'Assigned Nurse', 'Vital Alert', 'Notes'];
        const rows = beds.map((b) => [
          b.bedNumber,
          b.ward,
          b.room,
          b.status.toUpperCase(),
          b.patientId || 'N/A',
          b.patientName || 'Vacant',
          b.admissionDate || 'N/A',
          b.assignedDoctor || 'Unassigned',
          b.assignedNurse || 'Unassigned',
          b.vitalAlert ? 'YES (CRITICAL)' : 'NO',
          b.notes || '',
        ]);

        const result = await createHospitalSpreadsheet(accessToken, title, [
          { title: 'Bed Occupancy Board', headers, rows },
        ]);
        setActionSuccessMessage({ title: 'Bed Census exported to Google Sheets!', url: result.spreadsheetUrl });
        await fetchDriveSheets();
        handleSelectSheet(result.spreadsheetId);
      } else if (confirmModal.actionType === 'create_billing_sheet') {
        const title = `G-HIMS Revenue Audit & Billing (${new Date().toLocaleDateString()})`;
        const headers = ['Audit ID', 'Patient ID', 'Patient Name', 'Encounter ID', 'Documented Item', 'Category', 'CPT Code', 'Recoverable Rev ($)', 'Status', 'Date'];
        const rows = mismatches.map((m) => [
          m.id,
          m.patientId,
          m.patientName,
          m.encounterId,
          m.documentedItem,
          m.category,
          m.suggestedCptCode,
          m.estimatedRecoverableRevenue,
          m.status.toUpperCase(),
          m.date,
        ]);

        const result = await createHospitalSpreadsheet(accessToken, title, [
          { title: 'Revenue Leakage Audit', headers, rows },
        ]);
        setActionSuccessMessage({ title: 'Billing Audit exported to Google Sheets!', url: result.spreadsheetUrl });
        await fetchDriveSheets();
        handleSelectSheet(result.spreadsheetId);
      } else if (confirmModal.actionType === 'create_opd_sheet') {
        const title = `G-HIMS OPD Consultation Queue (${new Date().toLocaleDateString()})`;
        const headers = ['Token Number', 'Patient Name', 'MRN', 'Department', 'Assigned Doctor', 'Priority', 'Status', 'Arrival Time', 'Chief Complaint'];
        const rows = opdQueue.map((q) => [
          q.tokenNumber,
          q.patientName,
          q.mrn,
          q.department,
          q.assignedDoctor,
          q.priority.toUpperCase(),
          q.status.toUpperCase(),
          q.arrivalTime,
          q.chiefComplaint,
        ]);

        const result = await createHospitalSpreadsheet(accessToken, title, [
          { title: 'OPD Queue Tokens', headers, rows },
        ]);
        setActionSuccessMessage({ title: 'OPD Queue exported to Google Sheets!', url: result.spreadsheetUrl });
        await fetchDriveSheets();
        handleSelectSheet(result.spreadsheetId);
      }
    } catch (err: any) {
      console.error('Error executing sheet action:', err);
      alert(`Action failed: ${err.message || 'Unknown error'}`);
    } finally {
      setExecutingAction(false);
      setConfirmModal(null);
    }
  };

  const filteredSheets = spreadsheets.filter((s) =>
    s.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div id="google-sheets-subsystem" className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-emerald-900 via-teal-900 to-slate-900 border border-emerald-700/50 rounded-2xl p-6 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-emerald-500/10 to-transparent pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-xs font-semibold uppercase tracking-wider mb-2">
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Google Workspace & Sheets Hub
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-3">
              Google Sheets Live Interop
            </h1>
            <p className="text-sm sm:text-base text-emerald-100/80 mt-1 max-w-2xl">
              Bidirectional clinical synchronization, automated census exports, revenue ERP audit sheets, and live spreadsheet inspection powered by Google Sheets API.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!accessToken ? (
              <button
                type="button"
                onClick={handleConnectGoogle}
                className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-white hover:bg-slate-50 text-slate-900 font-semibold text-sm shadow-md transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <svg className="w-4 h-4" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                </svg>
                Connect Google Account
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-emerald-950/60 border border-emerald-500/40 rounded-xl px-3.5 py-2 text-xs">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-200 font-medium truncate max-w-[180px]">
                  {user?.email || 'Connected to Google'}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/30 text-[10px] font-bold text-emerald-300">
                  Sheets API Active
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Quick Exporter Action Bar */}
        <div className="mt-6 pt-5 border-t border-emerald-800/60 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <button
            type="button"
            onClick={() => triggerExportConfirmation('create_patient_sheet')}
            disabled={!accessToken}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-800/40 hover:bg-emerald-700/50 border border-emerald-600/40 text-xs font-medium text-emerald-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left"
          >
            <Users className="w-4 h-4 text-emerald-400 shrink-0" />
            <div>
              <div className="font-semibold text-white">Export Patients</div>
              <div className="text-[10px] text-emerald-300/80">{patients.length} records to Sheet</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => triggerExportConfirmation('create_census_sheet')}
            disabled={!accessToken}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-800/40 hover:bg-emerald-700/50 border border-emerald-600/40 text-xs font-medium text-emerald-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left"
          >
            <BedDouble className="w-4 h-4 text-teal-400 shrink-0" />
            <div>
              <div className="font-semibold text-white">Export Bed Census</div>
              <div className="text-[10px] text-teal-300/80">{beds.length} beds (ICU/Ward)</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => triggerExportConfirmation('create_billing_sheet')}
            disabled={!accessToken}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-800/40 hover:bg-emerald-700/50 border border-emerald-600/40 text-xs font-medium text-emerald-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left"
          >
            <DollarSign className="w-4 h-4 text-amber-400 shrink-0" />
            <div>
              <div className="font-semibold text-white">Export Billing Audit</div>
              <div className="text-[10px] text-amber-300/80">{mismatches.length} leakage audits</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => triggerExportConfirmation('create_opd_sheet')}
            disabled={!accessToken}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-800/40 hover:bg-emerald-700/50 border border-emerald-600/40 text-xs font-medium text-emerald-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left"
          >
            <Stethoscope className="w-4 h-4 text-blue-400 shrink-0" />
            <div>
              <div className="font-semibold text-white">Export OPD Queue</div>
              <div className="text-[10px] text-blue-300/80">{opdQueue.length} consultation tokens</div>
            </div>
          </button>
        </div>
      </div>

      {/* Action Success Alert */}
      {actionSuccessMessage && (
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between gap-3 text-sm text-emerald-900 dark:text-emerald-200 animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="font-semibold">{actionSuccessMessage.title}</span>
          </div>
          {actionSuccessMessage.url && (
            <a
              href={actionSuccessMessage.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs transition-colors"
            >
              Open in Google Sheets
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      )}

      {/* Not Signed In Warning Banner */}
      {!accessToken && (
        <div className="p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                Google Authentication & Permissions Required
              </h3>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                Sign in with your Google account to authorize G-HIMS to read and write spreadsheets in Google Drive on your behalf.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleConnectGoogle}
            className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs shadow-xs transition-colors shrink-0 flex items-center justify-center gap-2"
          >
            Authorize Google Sheets
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Drive Spreadsheets Explorer (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                Google Drive Spreadsheets
              </h2>
              <button
                type="button"
                onClick={fetchDriveSheets}
                disabled={!accessToken || loadingList}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="Refresh Drive List"
              >
                <RefreshCw className={`w-4 h-4 ${loadingList ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Search Spreadsheets */}
            <div className="relative mb-3">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search sheets in Drive..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
              />
            </div>

            {/* List */}
            <div className="space-y-1.5 max-h-[360px] overflow-y-auto pr-1">
              {loadingList ? (
                <div className="py-8 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-emerald-500" />
                  Loading spreadsheets from Google Drive...
                </div>
              ) : listError ? (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-xs">
                  {listError}
                </div>
              ) : filteredSheets.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">
                  {spreadsheets.length === 0
                    ? 'No Google Sheets found in your Google Drive.'
                    : 'No spreadsheets matched your search.'}
                </div>
              ) : (
                filteredSheets.map((sheet) => {
                  const isSelected = sheet.id === selectedSheetId;
                  return (
                    <button
                      key={sheet.id}
                      type="button"
                      onClick={() => handleSelectSheet(sheet.id)}
                      className={`w-full text-left p-2.5 rounded-xl transition-all flex items-center justify-between gap-2 border ${
                        isSelected
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-100 font-semibold shadow-xs'
                          : 'bg-slate-50/50 dark:bg-slate-850/50 hover:bg-slate-100 dark:hover:bg-slate-800 border-transparent text-slate-700 dark:text-slate-300 text-xs'
                      }`}
                    >
                      <div className="min-w-0 flex items-center gap-2.5">
                        <FileSpreadsheet
                          className={`w-4 h-4 shrink-0 ${
                            isSelected ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
                          }`}
                        />
                        <div className="truncate">
                          <div className="truncate font-medium">{sheet.name}</div>
                          {sheet.modifiedTime && (
                            <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                              {new Date(sheet.modifiedTime).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      </div>
                      <ChevronRight
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isSelected ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
                        }`}
                      />
                    </button>
                  );
                })
              )}
            </div>

            {/* Direct Connect by ID/URL */}
            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
              <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1.5">
                Open by Spreadsheet ID or URL:
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  value={customSheetInput}
                  onChange={(e) => setCustomSheetInput(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 rounded-lg text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  type="button"
                  onClick={handleConnectCustomSheet}
                  disabled={!customSheetInput.trim() || !accessToken}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 text-white font-medium text-xs transition-colors disabled:opacity-50"
                >
                  Open
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Live Sheet Viewer & Tab Inspector (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm min-h-[460px] flex flex-col">
            {/* Sheet Viewer Header */}
            {selectedMetadata ? (
              <div className="pb-4 border-b border-slate-100 dark:border-slate-800 mb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                        {selectedMetadata.properties.title}
                      </h2>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-medium text-[10px]">
                        Google Spreadsheet
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                      ID: {selectedSheetId}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <a
                      href={`https://docs.google.com/spreadsheets/d/${selectedSheetId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors"
                    >
                      Open in Docs
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>

                {/* Tabs Selector (Fetched dynamically to avoid hardcoding sheet names) */}
                {selectedMetadata.sheets && selectedMetadata.sheets.length > 0 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto mt-3 pt-2">
                    {selectedMetadata.sheets.map((tab) => {
                      const tabTitle = tab.properties.title;
                      const isActive = tabTitle === selectedTab;
                      return (
                        <button
                          key={tab.properties.sheetId}
                          type="button"
                          onClick={() => handleTabChange(tabTitle)}
                          className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors border ${
                            isActive
                              ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                              : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                          }`}
                        >
                          {tabTitle}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="pb-4 border-b border-slate-100 dark:border-slate-800 mb-4 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <Table className="w-4 h-4 text-slate-500" />
                  Spreadsheet Data Grid
                </h2>
              </div>
            )}

            {/* Sheet Values Grid */}
            <div className="flex-1 overflow-x-auto min-h-[300px]">
              {loadingValues ? (
                <div className="h-full flex flex-col items-center justify-center py-16 text-slate-500 text-xs gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-emerald-500" />
                  Loading sheet data range...
                </div>
              ) : valuesError ? (
                <div className="h-full flex flex-col items-center justify-center p-6 text-center text-xs text-red-600 dark:text-red-400">
                  <AlertCircle className="w-6 h-6 mb-2 text-red-500" />
                  <p className="font-semibold">Unable to read sheet values</p>
                  <p className="text-[11px] mt-1 max-w-sm">{valuesError}</p>
                </div>
              ) : !selectedSheetId ? (
                <div className="h-full flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500 text-center">
                  <FileSpreadsheet className="w-10 h-10 mb-3 text-slate-300 dark:text-slate-700" />
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    No Spreadsheet Selected
                  </p>
                  <p className="text-xs text-slate-500 max-w-xs mt-1">
                    Select a spreadsheet from the left column or use the quick export buttons above to create one.
                  </p>
                </div>
              ) : sheetValues.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center py-16 text-slate-400 text-xs">
                  The selected sheet tab is empty.
                </div>
              ) : (
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100/80 dark:bg-slate-800/90 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
                        <th className="p-2.5 w-12 text-center text-[10px] text-slate-400 font-mono border-r border-slate-200 dark:border-slate-700">
                          #
                        </th>
                        {sheetValues[0]?.map((colHeader, idx) => (
                          <th
                            key={idx}
                            className="p-2.5 font-bold uppercase tracking-wider text-[11px] border-r border-slate-200 dark:border-slate-700 last:border-r-0 whitespace-nowrap"
                          >
                            {colHeader || `Col ${idx + 1}`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-sans">
                      {sheetValues.slice(1).map((row, rowIdx) => (
                        <tr
                          key={rowIdx}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-850/50 transition-colors"
                        >
                          <td className="p-2 text-center text-[10px] font-mono text-slate-400 bg-slate-50/50 dark:bg-slate-850/50 border-r border-slate-200 dark:border-slate-800">
                            {rowIdx + 2}
                          </td>
                          {sheetValues[0]?.map((_, colIdx) => (
                            <td
                              key={colIdx}
                              className="p-2 text-slate-800 dark:text-slate-200 border-r border-slate-100 dark:border-slate-800 last:border-r-0 whitespace-nowrap text-xs"
                            >
                              {row[colIdx] !== undefined ? String(row[colIdx]) : ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Footer with Row Counts */}
            {sheetValues.length > 0 && (
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 mt-3 flex items-center justify-between text-[11px] text-slate-500">
                <span>
                  Showing {sheetValues.length - 1} data row(s) &bull; {sheetValues[0]?.length || 0} column(s)
                </span>
                <span className="font-mono text-[10px] text-slate-400">
                  Tab: {selectedTab || 'Active'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mandatory User Confirmation Dialog for Mutating Workspace Operations */}
      {confirmModal && confirmModal.isOpen && (
        <div
          id="sheets-mutation-confirm-modal"
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {confirmModal.title}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Google Workspace Mutation Confirmation
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-850 p-3.5 rounded-xl border border-slate-100 dark:border-slate-800">
              {confirmModal.description}
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                disabled={executingAction}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteConfirmedAction}
                disabled={executingAction}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors flex items-center gap-2"
              >
                {executingAction ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Executing Export...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Confirm & Create Sheet
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
