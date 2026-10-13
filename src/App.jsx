import React, { useState, useEffect, useRef } from "react";
import {
  Activity, Camera, LayoutDashboard, Play, Plus,
  Download, Eye, UploadCloud, Image as ImageIcon,
  FolderOpen, XCircle, Cpu, Search, Filter, History,
  Thermometer, FileSpreadsheet, Check
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import "./App.css";

const PI_BASE_URL = "http://10.79.190.135:8000";
const TB_TOKEN = "Mn54WmHAPBjl9psgLuoT";

const TB_ATTRIBUTES_URL = `/tb-api/api/v1/${TB_TOKEN}/attributes?clientKeys=latestAnalysis,analysisHistory`;
const API_BATCH_URL = `${PI_BASE_URL}/predict-batch`;
const API_STATUS_URL = `${PI_BASE_URL}/system-status`;

export default function App() {
  const [currentView, setCurrentView] = useState("dashboard");
  const [uploadedImage, setUploadedImage] = useState(null);
  const [uploadedBatchFiles, setUploadedBatchFiles] = useState([]);
  const [morphologyFile, setMorphologyFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [auditThresh, setAuditThresh] = useState(60);

  // System status & Temperature
  const [isPiConnected, setIsPiConnected] = useState(false);
  const [piTemperature, setPiTemperature] = useState(null);

  // Search & Filters
  const [searchFilename, setSearchFilename] = useState("");
  const [selectedTaxonFilter, setSelectedTaxonFilter] = useState("ALL");
  const [historyList, setHistoryList] = useState([]);
  const [isLoadingCloud, setIsLoadingCloud] = useState(false);

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const csvInputRef = useRef(null);

  const [latestResult, setLatestResult] = useState({
    sampleId: "No Analysis Yet",
    timestamp: "-",
    totalOrganisms: 0,
    speciesRichness: 0,
    avgConfidence: 0,
    shannonIndex: 0,
    phytoCount: 0,
    zooCount: 0,
    processingTime: "-",
    species: [],
    specimens: [],
    ecologicalAdvisory: "Awaiting analysis records from ThingsBoard Cloud.",
    morphologyMode: "Auto Edge CV"
  });

  const fetchCloudData = async () => {
    setIsLoadingCloud(true);
    try {
      const res = await fetch(TB_ATTRIBUTES_URL);
      if (res.ok) {
        const data = await res.json();
        const clientData = data.client || {};

        if (clientData.latestAnalysis) {
          const parsedLatest = typeof clientData.latestAnalysis === "string" 
            ? JSON.parse(clientData.latestAnalysis) 
            : clientData.latestAnalysis;
          setLatestResult(parsedLatest);
        }

        if (clientData.analysisHistory) {
          const parsedHistory = typeof clientData.analysisHistory === "string"
            ? JSON.parse(clientData.analysisHistory)
            : clientData.analysisHistory;
          setHistoryList(parsedHistory);
        }
      }
    } catch (err) {
      console.warn("ThingsBoard fetch error:", err);
    } finally {
      setIsLoadingCloud(false);
    }
  };

  const checkPiHealth = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(API_STATUS_URL, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        setIsPiConnected(true);
        setPiTemperature(data.cpu_temperature);
      } else {
        setIsPiConnected(false);
      }
    } catch (e) {
      setIsPiConnected(false);
    }
  };

  useEffect(() => {
    fetchCloudData();
    checkPiHealth();
    const interval = setInterval(checkPiHealth, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleClearUpload = () => {
    setUploadedImage(null);
    setUploadedBatchFiles([]);
    setMorphologyFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
    if (csvInputRef.current) csvInputRef.current.value = "";
  };

  const handleMultipleFiles = (fileList) => {
    const files = Array.from(fileList).filter(f =>
      f.type.startsWith("image/") || /\.(png|jpe?g|webp|tif|bmp)$/i.test(f.name)
    );

    if (files.length === 0) {
      alert("Please select valid image file(s).");
      return;
    }

    setUploadedBatchFiles(files);
    const reader = new FileReader();
    reader.onload = (e) => setUploadedImage(e.target.result);
    reader.readAsDataURL(files[0]);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleMultipleFiles(e.dataTransfer.files);
    }
  };

  const handleAnalyze = async () => {
    if (uploadedBatchFiles.length === 0 && !uploadedImage) {
      alert("Please upload micrograph image(s) or folder first.");
      return;
    }

    if (!isPiConnected) {
      alert("Raspberry Pi 5 is currently disconnected. Please turn on Pi 5 to run inference.");
      return;
    }

    setIsAnalyzing(true);
    const formData = new FormData();
    uploadedBatchFiles.forEach((file) => {
      formData.append("files", file);
    });

    // Attach FlowCAM Morphology CSV if provided (Scenario B)
    if (morphologyFile) {
      formData.append("morphology_file", morphologyFile);
    }

    try {
      const response = await fetch(`${API_BATCH_URL}?audit_threshold=${auditThresh}`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const payload = await response.json();
      if (payload.summary) {
        setLatestResult(payload.summary);
      }

      setTimeout(fetchCloudData, 1500);
      setCurrentView("result");
    } catch (err) {
      console.error("Inference Error:", err);
      alert("Failed to connect to Raspberry Pi 5 backend at " + API_BATCH_URL);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleExportCSV = () => {
    if (!latestResult.specimens.length) return;
    const headers = ["Filename,Predicted_Taxon,Confidence,Status,Domain,Biometrics_Source,Area_um2,Feret_Max_um,Aspect_Ratio,Circularity,Cloud_Image_URL\n"];
    const rows = latestResult.specimens.map(s =>
      `"${s.filename}","${s.prediction}",${s.confidence},"${s.status}","${s.domain}","${s.biometrics_source || 'Edge CV'}",${s.area_um2},${s.feret_max_um},${s.aspect_ratio},${s.circularity},"${s.imageUrl || ''}"`
    );
    const blob = new Blob([...headers, ...rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `MarineAI_File_Species_Audit_${Date.now()}.csv`;
    a.click();
  };

  const handleExportReport = () => {
    const doc = new jsPDF();
    doc.setFillColor(15, 76, 129);
    doc.rect(0, 0, 210, 24, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("MARINE FLOWCAM - CLOUD TAXONOMIC AUDIT", 14, 16);

    doc.setTextColor(30, 41, 59);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(`Batch ID: ${latestResult.sampleId}`, 14, 34);
    doc.setFont("helvetica", "normal");
    doc.text(`Generated: ${latestResult.timestamp} | Mode: ${latestResult.morphologyMode || 'Auto Edge CV'}`, 14, 40);

    autoTable(doc, {
      startY: 46,
      head: [["Metric", "Value", "Status"]],
      body: [
        ["Total Evaluated Files", `${latestResult.totalOrganisms}`, "Processed"],
        ["Species Richness", `${latestResult.speciesRichness}`, "Living Taxa"],
        ["Shannon Diversity (H')", `${latestResult.shannonIndex}`, `${latestResult.shannonIndex >= 1.5 ? "Healthy" : "Dominant"}`],
        ["Biometrics Source", `${latestResult.morphologyMode || 'Auto Edge CV'}`, "Calibrated"]
      ],
      theme: "grid",
      headStyles: { fillColor: [15, 76, 129] }
    });

    const finalY = doc.lastAutoTable.finalY || 95;
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("File-by-File Species Identification Register", 14, finalY + 10);

    const tableData = latestResult.specimens.slice(0, 80).map(s => [
      s.filename,
      s.prediction,
      `${s.confidence}%`,
      s.status,
      `${s.area_um2} um2`,
      s.biometrics_source || "Edge CV"
    ]);

    autoTable(doc, {
      startY: finalY + 14,
      head: [["File Name", "Species", "Confidence", "Status", "Area", "Source"]],
      body: tableData,
      theme: "striped",
      headStyles: { fillColor: [51, 65, 85] }
    });

    doc.save(`MarineAI_Cloud_Report_${Date.now()}.pdf`);
  };

  const hasFilesStaged = (uploadedBatchFiles.length > 0) || !!uploadedImage;

  const filteredSpecimens = (latestResult.specimens || []).filter(s => {
    const matchesTaxon = (selectedTaxonFilter === "ALL") || (s.prediction === selectedTaxonFilter);
    const matchesSearch = s.filename.toLowerCase().includes(searchFilename.toLowerCase());
    return matchesTaxon && matchesSearch;
  });

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <div className="logo-group" onClick={() => setCurrentView("dashboard")}>
            <Activity size={22} color="#0f4c81" />
            <span style={{ fontSize: "19px", fontWeight: "800", letterSpacing: "0.5px" }}>MARINE FLOWCAM AI</span>
          </div>
        </div>

        {/* Live Status and Pi Temperature */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {isPiConnected ? (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: "#ecfdf5",
              border: "1px solid #a7f3d0",
              color: "#065f46",
              padding: "5px 12px",
              borderRadius: "20px",
              fontSize: "12px",
              fontWeight: 700
            }}>
              <span className="status-dot" style={{ background: "#10b981" }}></span>
              Connected (10.79.190.135)
              {piTemperature && (
                <span style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "3px",
                  marginLeft: "6px",
                  paddingLeft: "8px",
                  borderLeft: "1px solid #6ee7b7",
                  color: "#047857"
                }}>
                  <Thermometer size={14} /> {piTemperature}°C
                </span>
              )}
            </div>
          ) : (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#991b1b",
              padding: "5px 12px",
              borderRadius: "20px",
              fontSize: "12px",
              fontWeight: 700
            }}>
              <span className="status-dot" style={{ background: "#ef4444" }}></span>
              Disconnected (Cloud Mode Active)
            </div>
          )}

          <button
            onClick={fetchCloudData}
            title="Refresh ThingsBoard Cloud Data"
            style={{
              background: "#ffffff",
              border: "1px solid #cbd5e1",
              borderRadius: "6px",
              padding: "5px 10px",
              fontSize: "12px",
              cursor: "pointer",
              fontWeight: 600,
              color: "#0f4c81"
            }}
          >
            ☁️ Sync Cloud
          </button>
        </div>
      </header>

      {/* App Body with Sidebar */}
      <div className="app-body">
        <aside className="nav-sidebar">
          <div
            className={`nav-item ${currentView === "dashboard" ? "active" : ""}`}
            onClick={() => setCurrentView("dashboard")}
          >
            <LayoutDashboard size={18} /> Dashboard
          </div>
          <div
            className={`nav-item ${currentView === "analysis" ? "active" : ""}`}
            onClick={() => setCurrentView("analysis")}
          >
            <Camera size={18} /> Ingest Files / Folder
          </div>
          <div
            className={`nav-item ${currentView === "result" ? "active" : ""}`}
            onClick={() => setCurrentView("result")}
          >
            <Eye size={18} /> Cloud Specimen Gallery
          </div>
          <div
            className={`nav-item ${currentView === "history" ? "active" : ""}`}
            onClick={() => setCurrentView("history")}
          >
            <History size={18} /> Past Analysis History
          </div>
        </aside>

        <main className="main-content">
          {/* VIEW 1: DASHBOARD */}
          {currentView === "dashboard" && (
            <div>
              <div className="page-title-section">
                <div>
                  <h1 className="page-title">Ecological & Specimen Overview</h1>
                  <p style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                    Synchronized live with ThingsBoard Cloud & Dropbox CDN
                  </p>
                </div>
                <button className="btn-primary" onClick={() => setCurrentView("analysis")}>
                  <Plus size={16} /> Start new analysis
                </button>
              </div>

              <div className="grid-cards">
                <div className="card">
                  <div className="card-value">{latestResult.totalOrganisms || 0}</div>
                  <div className="card-title">Total Evaluated Files</div>
                </div>
                <div className="card">
                  <div className="card-value">{latestResult.speciesRichness || 0}</div>
                  <div className="card-title">Species Richness</div>
                </div>
                <div className="card">
                  <div className="card-value" style={{ color: "#10b981" }}>{latestResult.phytoCount || 0}</div>
                  <div className="card-title">Phytoplankton Count</div>
                </div>
                <div className="card">
                  <div className="card-value" style={{ color: "#0284c7" }}>{latestResult.zooCount || 0}</div>
                  <div className="card-title">Zooplankton Count</div>
                </div>
                <div className="card" style={{ borderLeft: "4px solid #0f4c81" }}>
                  <div className="card-value" style={{ color: "#0f4c81" }}>{latestResult.shannonIndex || 0}</div>
                  <div className="card-title">Shannon Index (H')</div>
                </div>
              </div>

              <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px" }}>
                <div>
                  <div className="eyebrow">Active Cloud Run Record</div>
                  <div style={{ fontWeight: 700, fontSize: "16px" }}>
                    {latestResult.sampleId} &nbsp;
                    <span style={{ fontSize: "11px", padding: "2px 8px", background: "#f1f5f9", borderRadius: "10px", color: "#475569" }}>
                      Mode: {latestResult.morphologyMode || 'Auto Edge CV'}
                    </span>
                  </div>
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                    {latestResult.totalOrganisms > 0
                      ? `${latestResult.totalOrganisms} files classified. Processing Speed: ${latestResult.processingTime}. Synced at ${latestResult.timestamp}.`
                      : "No active slide analyzed yet. Go to 'Ingest Files / Folder' to process images."}
                  </div>
                </div>
                {latestResult.totalOrganisms > 0 && (
                  <button className="btn-secondary" onClick={() => setCurrentView("result")}>
                    <Eye size={14} /> Open Cloud Gallery
                  </button>
                )}
              </div>
            </div>
          )}

          {/* VIEW 2: INGESTION VIEW */}
          {currentView === "analysis" && (
            <div>
              <div className="page-title-section">
                <div>
                  <h1 className="page-title">Batch Specimen Ingestion (Dual-Mode)</h1>
                  <p style={{ fontSize: "12px", color: "#64748b" }}>
                    Upload image crops alone, or attach FlowCAM morphology table for hardware precision
                  </p>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "13px", color: "#64748b" }}>Audit Threshold:</span>
                  <input
                    type="range"
                    min="40"
                    max="85"
                    value={auditThresh}
                    onChange={(e) => setAuditThresh(e.target.value)}
                  />
                  <span style={{ fontWeight: 700, color: "#0f4c81" }}>{auditThresh}%</span>
                </div>
              </div>

              <div className="capture-layout">
                <div className="card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <span style={{ fontWeight: 600, fontSize: "14px" }}>
                      Micrograph Image Ingestion
                    </span>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "12px", fontWeight: 600, color: hasFilesStaged ? "#15803d" : "#0f4c81" }}>
                        • {uploadedBatchFiles.length > 1
                            ? `${uploadedBatchFiles.length} Specimen Crops Staged`
                            : (uploadedImage ? "1 Image Staged" : "Awaiting File(s) / Folder")}
                      </span>

                      {hasFilesStaged && (
                        <button
                          type="button"
                          onClick={handleClearUpload}
                          title="Clear current selection"
                          style={{
                            background: "#fee2e2",
                            border: "1px solid #fca5a5",
                            borderRadius: "4px",
                            padding: "2px 8px",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            fontSize: "11px",
                            fontWeight: 700,
                            color: "#b91c1c"
                          }}
                        >
                          <XCircle size={12} /> Clear
                        </button>
                      )}
                    </div>
                  </div>

                  <div
                    className={`upload-dropzone ${isDragging ? "dragging" : ""} ${hasFilesStaged ? "has-file" : ""}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      style={{ display: "none" }}
                      accept="image/*"
                      multiple
                      onChange={(e) => e.target.files && handleMultipleFiles(e.target.files)}
                    />
                    <input
                      type="file"
                      ref={folderInputRef}
                      style={{ display: "none" }}
                      webkitdirectory=""
                      directory=""
                      multiple
                      onChange={(e) => e.target.files && handleMultipleFiles(e.target.files)}
                    />

                    {uploadedBatchFiles.length > 1 ? (
                      <div className="dropzone-content">
                        <FolderOpen size={48} color="#0f4c81" style={{ marginBottom: "12px" }} />
                        <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                          Images Staged Successfully!
                        </h3>
                        <p style={{ fontSize: "14px", color: "#15803d", fontWeight: 700, marginBottom: "8px" }}>
                          📁 {uploadedBatchFiles.length} Specimen Images Ready for Edge Compute
                        </p>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={handleClearUpload}
                          style={{ borderColor: "#fca5a5", color: "#b91c1c", background: "#fef2f2" }}
                        >
                          <XCircle size={14} /> Clear & Pick Others
                        </button>
                      </div>
                    ) : (
                      uploadedImage ? (
                        <div className="uploaded-preview-wrapper">
                          <img src={uploadedImage} alt="Uploaded Specimen" className="uploaded-preview-img" />
                        </div>
                      ) : (
                        <div className="dropzone-content">
                          <UploadCloud size={46} color="#0f4c81" style={{ marginBottom: "12px", opacity: 0.8 }} />
                          <h4 style={{ fontSize: "15px", fontWeight: 700, marginBottom: "6px" }}>
                            Drag and drop plankton image(s) or folder here
                          </h4>
                          <p style={{ fontSize: "12px", color: "#64748b", marginBottom: "16px" }}>
                            Transmits to Raspberry Pi 5 &rarr; Uploads to Dropbox &rarr; Syncs to ThingsBoard
                          </p>
                          <div style={{ display: "flex", gap: "10px" }}>
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={() => fileInputRef.current?.click()}
                            >
                              <ImageIcon size={14} /> Select File(s)
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => folderInputRef.current?.click()}
                            >
                              <FolderOpen size={14} /> Upload Folder
                            </button>
                          </div>
                        </div>
                      )
                    )}
                  </div>

                  {/* FlowCAM Morphology CSV Section (Scenario B) */}
                  <div style={{
                    marginTop: "16px",
                    padding: "12px",
                    background: "#f8fafc",
                    border: "1px dashed #cbd5e1",
                    borderRadius: "8px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <FileSpreadsheet size={22} color={morphologyFile ? "#15803d" : "#64748b"} />
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b" }}>
                          {morphologyFile ? morphologyFile.name : "Attach FlowCAM Morphology Table (Optional)"}
                        </div>
                        <div style={{ fontSize: "11px", color: "#64748b" }}>
                          {morphologyFile
                            ? "Hardware biometrics mapped directly to images"
                            : "If omitted, edge OpenCV automatically estimates morphology"}
                        </div>
                      </div>
                    </div>

                    <input
                      type="file"
                      ref={csvInputRef}
                      style={{ display: "none" }}
                      accept=".csv,.tsv,.txt"
                      onChange={(e) => e.target.files && setMorphologyFile(e.target.files[0])}
                    />

                    {morphologyFile ? (
                      <button
                        type="button"
                        onClick={() => { setMorphologyFile(null); if (csvInputRef.current) csvInputRef.current.value = ""; }}
                        style={{
                          background: "#fee2e2",
                          border: "1px solid #fca5a5",
                          borderRadius: "4px",
                          padding: "4px 8px",
                          fontSize: "11px",
                          fontWeight: 700,
                          color: "#b91c1c",
                          cursor: "pointer"
                        }}
                      >
                        Remove CSV
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ fontSize: "12px", padding: "5px 10px" }}
                        onClick={() => csvInputRef.current?.click()}
                      >
                        Select .CSV
                      </button>
                    )}
                  </div>
                </div>

                <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                  <div>
                    <h3 style={{ fontSize: "15px", fontWeight: 700 }}>Processing Architecture</h3>
                    <ul className="checklist">
                      <li>
                        <span className="step-num">1</span>
                        <b>Vision Inference:</b> Dual-branch ONNX on Raspberry Pi 5 CPU.
                      </li>
                      <li>
                        <span className="step-num">2</span>
                        <b>Biometrics Mode:</b> {morphologyFile ? "Hardware Calibrated (Scenario B)" : "Auto OpenCV Silhouette (Scenario A)"}
                      </li>
                      <li>
                        <span className="step-num">3</span>
                        <b>Cloud Storage:</b> Micrographs synced to Scoped Dropbox CDN.
                      </li>
                      <li>
                        <span className="step-num">4</span>
                        <b>Telemetry & Audit:</b> Run records archived in ThingsBoard Cloud.
                      </li>
                    </ul>
                  </div>

                  <button
                    className={hasFilesStaged && isPiConnected ? "btn-primary" : "btn-secondary"}
                    style={{
                      justifyContent: "center",
                      padding: "12px",
                      cursor: (hasFilesStaged && isPiConnected) ? "pointer" : "not-allowed"
                    }}
                    onClick={handleAnalyze}
                    disabled={!hasFilesStaged || !isPiConnected || isAnalyzing}
                  >
                    <Play size={16} /> {isAnalyzing
                      ? "RPi 5 Processing & Cloud Syncing..."
                      : (!isPiConnected
                          ? "Pi 5 Disconnected (Connect Pi to Run)"
                          : (uploadedBatchFiles.length > 1
                              ? `Execute ${uploadedBatchFiles.length} Specimens on Pi 5`
                              : "Run Edge Analysis"))}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* VIEW 3: RESULTS VIEW */}
          {currentView === "result" && (
            <div>
              <div className="page-title-section">
                <div>
                  <div className="eyebrow">
                    Cloud Retrieval: {latestResult.sampleId} &bull; Mode: {latestResult.morphologyMode || 'Auto Edge CV'}
                  </div>
                  <h1 className="page-title">Taxonomic Breakdown & Specimen File Mapping</h1>
                </div>
                <div style={{ display: "flex", gap: "10px" }}>
                  <button className="btn-secondary" onClick={handleExportCSV}>
                    <Download size={15} /> Export File-Species CSV
                  </button>
                  <button className="btn-primary" onClick={handleExportReport}>
                    <Download size={15} /> Export Lab PDF
                  </button>
                </div>
              </div>

              {/* Ecological Advisory */}
              <div className="card" style={{
                marginBottom: "20px",
                borderLeft: "4px solid #10b981",
                background: "#f0fdf4"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Cpu size={18} color="#10b981" />
                    <strong style={{ color: "#0f4c81", fontSize: "15px" }}>Marine Ecological Assessment</strong>
                  </div>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "#166534", background: "#dcfce7", padding: "2px 8px", borderRadius: "12px" }}>
                    ThingsBoard Synced
                  </span>
                </div>
                <p style={{ color: "#1e293b", fontSize: "14px", lineHeight: "1.6" }}>
                  {latestResult.ecologicalAdvisory || "No advisory available."}
                </p>
              </div>

              {/* KPI Cards */}
              <div className="grid-cards" style={{ marginBottom: "20px" }}>
                <div className="card">
                  <div className="card-value">{latestResult.totalOrganisms || 0}</div>
                  <div className="card-title">Total Evaluated Files</div>
                </div>
                <div className="card">
                  <div className="card-value">{latestResult.speciesRichness || 0}</div>
                  <div className="card-title">Species Richness</div>
                </div>
                <div className="card">
                  <div className="card-value" style={{ color: "#0f4c81" }}>{latestResult.shannonIndex || 0}</div>
                  <div className="card-title">Shannon Index (H')</div>
                </div>
                <div className="card">
                  <div className="card-value">{latestResult.processingTime || "-"}</div>
                  <div className="card-title">Inference Speed</div>
                </div>
                <div className="card">
                  <div className="card-value">{latestResult.avgConfidence || 0}%</div>
                  <div className="card-title">Avg Confidence</div>
                </div>
              </div>

              {/* SPECIMEN GALLERY WITH CLOUD THUMBNAILS & BIOMETRICS SOURCE BADGES */}
              <div className="card" style={{ marginBottom: "24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
                  <div>
                    <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#0f4c81" }}>
                      Cloud Micrograph Gallery (Dropbox CDN)
                    </h3>
                    <p style={{ fontSize: "12px", color: "#64748b" }}>
                      Each cell tagged with measured Area, Feret Max, Aspect Ratio & Biometrics Source
                    </p>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <div style={{ position: "relative" }}>
                      <input
                        type="text"
                        placeholder="Search filename..."
                        value={searchFilename}
                        onChange={(e) => setSearchFilename(e.target.value)}
                        style={{
                          padding: "6px 12px 6px 28px",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          fontSize: "12px"
                        }}
                      />
                      <Search size={14} color="#94a3b8" style={{ position: "absolute", left: "8px", top: "8px" }} />
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <Filter size={14} color="#64748b" />
                      <select
                        value={selectedTaxonFilter}
                        onChange={(e) => setSelectedTaxonFilter(e.target.value)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          fontSize: "12px",
                          background: "#ffffff"
                        }}
                      >
                        <option value="ALL">All Taxa ({(latestResult.specimens || []).length})</option>
                        {(latestResult.species || []).map(s => (
                          <option key={s.name} value={s.name}>
                            {s.name} ({s.count})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
                  gap: "14px",
                  maxHeight: "520px",
                  overflowY: "auto",
                  padding: "6px"
                }}>
                  {filteredSpecimens.map((spec, idx) => {
                    const isVerified = (spec.status === "Verified");
                    const isDetritus = (spec.prediction === "Detritus_Artifact");
                    const isHwBio = (spec.biometrics_source === "Hardware CSV (FlowCAM)");
                    return (
                      <div
                        key={idx}
                        style={{
                          background: "#ffffff",
                          border: `1px solid ${isVerified ? "#cbd5e1" : "#fcd34d"}`,
                          borderRadius: "8px",
                          overflow: "hidden",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                          display: "flex",
                          flexDirection: "column"
                        }}
                      >
                        <div style={{
                          height: "130px",
                          background: "#090d16",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          position: "relative"
                        }}>
                          {spec.imageUrl ? (
                            <img
                              src={spec.imageUrl}
                              alt={spec.filename}
                              style={{
                                maxWidth: "100%",
                                maxHeight: "100%",
                                objectFit: "contain"
                              }}
                              onError={(e) => {
                                e.target.onerror = null;
                                e.target.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' fill='%2364748b'><text x='20' y='55'>Micrograph</text></svg>";
                              }}
                            />
                          ) : (
                            <div style={{ color: "#64748b", fontSize: "11px" }}>Local Preview</div>
                          )}
                          <span style={{
                            position: "absolute",
                            bottom: "6px",
                            right: "6px",
                            background: "rgba(0,0,0,0.75)",
                            color: "#fff",
                            fontSize: "10px",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontFamily: "monospace"
                          }}>
                            {spec.confidence}%
                          </span>

                          <span style={{
                            position: "absolute",
                            top: "6px",
                            left: "6px",
                            background: isHwBio ? "rgba(16, 185, 129, 0.85)" : "rgba(30, 41, 59, 0.8)",
                            color: "#fff",
                            fontSize: "9px",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontWeight: 600
                          }}>
                            {isHwBio ? "⚡ FlowCAM CSV" : "👁️ Edge CV"}
                          </span>
                        </div>

                        <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: "4px", flex: 1 }}>
                          <span style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            color: "#64748b",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis"
                          }} title={spec.filename}>
                            📄 {spec.filename}
                          </span>

                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                            <span className={`domain-pill ${isDetritus ? "detritus" : (spec.domain === "Zooplankton" ? "zoo" : (spec.domain === "Audit Queue" ? "audit" : "phyto"))}`}>
                              {spec.domain}
                            </span>
                            <strong style={{
                              fontSize: "13px",
                              color: isVerified ? "#0f4c81" : "#b45309",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis"
                            }}>
                              {spec.prediction}
                            </strong>
                          </div>

                          <div style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: "11px",
                            color: "#94a3b8",
                            marginTop: "6px",
                            borderTop: "1px solid #f1f5f9",
                            paddingTop: "6px"
                          }}>
                            <span>Area: {spec.area_um2} µm²</span>
                            <span>AR: {spec.aspect_ratio}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Abundance summary */}
              <div className="card" style={{ marginBottom: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#0f4c81" }}>
                    Species Abundance by Taxon
                  </h3>
                  <span style={{ fontSize: "12px", color: "#64748b" }}>
                    Aggregated Biomass Summary
                  </span>
                </div>

                <div className="species-card-grid">
                  {(latestResult.species || []).map((sp, idx) => (
                    <div key={idx} className="species-pill-card">
                      <div>
                        <span className={`domain-pill ${sp.domain === "Phytoplankton" ? "phyto" : (sp.domain === "Detritus" ? "detritus" : (sp.domain === "Audit Queue" ? "audit" : "zoo"))}`}>
                          {sp.domain || "Taxon"}
                        </span>
                        <div className="species-name" style={{ marginTop: "4px" }}>{sp.name}</div>
                      </div>
                      <div className="species-count">{sp.count}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* VIEW 4: PAST ANALYSIS HISTORY VIEW */}
          {currentView === "history" && (
            <div>
              <div className="page-title-section">
                <div>
                  <div className="eyebrow">Cloud Archive & Audit Register</div>
                  <h1 className="page-title">Past Run Analysis History (ThingsBoard Cloud)</h1>
                  <p style={{ fontSize: "12px", color: "#64748b" }}>
                    Taxonomists can access past sample runs at any time, even if Raspberry Pi is powered off.
                  </p>
                </div>
                <div style={{ display: "flex", gap: "10px" }}>
                  <button className="btn-secondary" onClick={fetchCloudData}>
                    Refresh Cloud History
                  </button>
                  <button className="btn-primary" onClick={() => setCurrentView("analysis")}>
                    <Plus size={16} /> New Analysis
                  </button>
                </div>
              </div>

              <div className="card">
                {isLoadingCloud ? (
                  <div style={{ padding: "30px", textAlign: "center", color: "#64748b" }}>
                    Retrieving run records from ThingsBoard Cloud...
                  </div>
                ) : historyList.length > 0 ? (
                  <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ color: "#64748b", textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>
                        <th style={{ padding: "12px 8px" }}>SAMPLE ID</th>
                        <th>TIMESTAMP</th>
                        <th>CROPS</th>
                        <th>MODE</th>
                        <th>SPECIES RICHNESS</th>
                        <th>SHANNON INDEX (H')</th>
                        <th>AVG CONF</th>
                        <th style={{ textAlign: "right", paddingRight: "12px" }}>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyList.map((run, idx) => (
                        <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "12px 8px", fontWeight: 700, color: "#0f4c81" }}>
                            {run.sampleId}
                          </td>
                          <td style={{ color: "#64748b" }}>{run.timestamp}</td>
                          <td><b>{run.totalOrganisms}</b></td>
                          <td>
                            <span style={{
                              fontSize: "11px",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              background: run.morphologyMode === "Hardware CSV" ? "#ecfdf5" : "#f1f5f9",
                              color: run.morphologyMode === "Hardware CSV" ? "#065f46" : "#475569"
                            }}>
                              {run.morphologyMode || "Auto Edge CV"}
                            </span>
                          </td>
                          <td>{run.speciesRichness} Taxa</td>
                          <td>
                            <span style={{
                              fontWeight: 700,
                              color: run.shannonIndex >= 1.5 ? "#10b981" : "#b45309"
                            }}>
                              {run.shannonIndex}
                            </span>
                          </td>
                          <td>{run.avgConfidence}%</td>
                          <td style={{ textAlign: "right", paddingRight: "12px" }}>
                            <button
                              className="btn-secondary"
                              style={{ padding: "4px 12px", fontSize: "12px" }}
                              onClick={() => {
                                setLatestResult(run);
                                setCurrentView("result");
                              }}
                            >
                              <Eye size={13} style={{ marginRight: "4px" }} /> Inspect Gallery
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                    <History size={40} color="#cbd5e1" style={{ marginBottom: "12px" }} />
                    <p style={{ fontWeight: 600, fontSize: "15px", color: "#1e293b", marginBottom: "4px" }}>
                      No Past Runs Found in ThingsBoard
                    </p>
                    <p style={{ fontSize: "13px" }}>
                      Once a batch is analyzed, its full record will appear here permanently from ThingsBoard Cloud.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
