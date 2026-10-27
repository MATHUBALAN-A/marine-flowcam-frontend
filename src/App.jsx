import React, { useState, useEffect, useRef } from "react";
import {
  Activity, Camera, LayoutDashboard, Play, Plus,
  Download, Eye, UploadCloud, Image as ImageIcon,
  FolderOpen, XCircle, Cpu, Search, Filter, History,
  Thermometer, FileSpreadsheet, RefreshCw, Layers
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import "./App.css";

const PI_IP = "172.17.166.135";
const PI_BASE_URL = `http://${PI_IP}:8000`;

const PI_STREAM_URL = `http://${PI_IP}:5000/api/stream`;
const PI_CAPTURE_URL = `http://${PI_IP}:5000/api/capture`;

const API_BATCH_URL = `${PI_BASE_URL}/predict-batch`;
const API_YOLO_URL = `${PI_BASE_URL}/predict-microscope-yolo`;
const API_YOLO_BATCH_URL = `${PI_BASE_URL}/predict-microscope-yolo-batch`;
const API_STATUS_URL = `${PI_BASE_URL}/system-status`;

const TB_TOKEN = "Mn54WmHAPBjl9psgLuoT";
const TB_ATTRIBUTES_URL = `/tb-api/api/v1/${TB_TOKEN}/attributes?clientKeys=latestAnalysis,analysisHistory`;

export default function App() {
  const [currentView, setCurrentView] = useState("dashboard");
  const [ingestMode, setIngestMode] = useState("camera"); 

  const [capturedImage, setCapturedImage] = useState(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [yoloConfThresh, setYoloConfThresh] = useState(0.50);

  const [opticalBatchFiles, setOpticalBatchFiles] = useState([]);
  const [opticalImage, setOpticalImage] = useState(null); 

  const [uploadedImage, setUploadedImage] = useState(null);
  const [uploadedBatchFiles, setUploadedBatchFiles] = useState([]);
  const [morphologyFile, setMorphologyFile] = useState(null);
  const [auditThresh, setAuditThresh] = useState(60);

  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPiConnected, setIsPiConnected] = useState(false);
  const [piTemperature, setPiTemperature] = useState(null);

  const [searchFilename, setSearchFilename] = useState("");
  const [selectedTaxonFilter, setSelectedTaxonFilter] = useState("ALL");
  const [historyList, setHistoryList] = useState([]);
  const [isLoadingCloud, setIsLoadingCloud] = useState(false);

  // FULL SCREEN, ZOOM & PAN STATES
  const [fullScreenImage, setFullScreenImage] = useState(null);
  const [imageZoom, setImageZoom] = useState(90); 
  const [isPanning, setIsPanning] = useState(false);

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const csvInputRef = useRef(null);
  const opticalInputRef = useRef(null);
  const opticalFolderRef = useRef(null);
  const galleryRef = useRef(null);
  const scrollContainerRef = useRef(null);

  const [latestResult, setLatestResult] = useState({
    sampleId: "No Analysis Yet", timestamp: "-", totalOrganisms: 0, speciesRichness: 0,
    avgConfidence: 0, shannonIndex: 0, phytoCount: 0, zooCount: 0, processingTime: "-",
    species: [], specimens: [], detections: [], rawImageUrl: "", annotatedImageUrl: "",
    yoloImages: [], analysisMode: "FlowCAM Dual-Branch", morphologyMode: "Auto Edge CV",
  });

  const fetchCloudData = async () => {
    setIsLoadingCloud(true);
    try {
      const res = await fetch(TB_ATTRIBUTES_URL);
      if (res.ok) {
        const data = await res.json();
        const clientData = data.client || {};

        if (clientData.latestAnalysis) {
          const parsedLatest = typeof clientData.latestAnalysis === "string" ? JSON.parse(clientData.latestAnalysis) : clientData.latestAnalysis;
          setLatestResult(parsedLatest);
        }
        if (clientData.analysisHistory) {
          const parsedHistory = typeof clientData.analysisHistory === "string" ? JSON.parse(clientData.analysisHistory) : clientData.analysisHistory;
          if (Array.isArray(parsedHistory)) setHistoryList(parsedHistory);
        }
      }
    } catch (err) {
      console.warn("ThingsBoard fetch glitch:", err);
    } finally {
      setIsLoadingCloud(false);
    }
  };

  const checkPiHealth = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(API_STATUS_URL, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        setIsPiConnected(true);
        setPiTemperature(data.cpu_temperature);
      } else setIsPiConnected(false);
    } catch {
      setIsPiConnected(false);
    }
  };

  useEffect(() => {
    fetchCloudData();
    checkPiHealth();
    const interval = setInterval(checkPiHealth, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleCaptureFrame = async () => {
    if (!isPiConnected) return alert("Raspberry Pi is offline.");
    setIsCapturing(true);
    try {
      const res = await fetch(PI_CAPTURE_URL, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setCapturedImage(data.image);
      } else alert("Failed to capture slide frame.");
    } catch (err) {
      console.error(err);
      alert("Could not reach camera service on port 5000.");
    } finally {
      setIsCapturing(false);
    }
  };

  const handleMultipleFiles = (fileList, targetMode) => {
    const files = Array.from(fileList).filter(f => f.type.startsWith("image/") || /\.(png|jpe?g|webp|tiff?|bmp)$/i.test(f.name));
    if (files.length === 0) return alert("Please select valid image file(s).");

    if (targetMode === "upload") {
      setOpticalBatchFiles(prevFiles => {
        const combined = [...prevFiles, ...files];
        return combined.filter((v, i, a) => a.findIndex(t => t.name === v.name) === i);
      });
      if (!opticalImage && files.length > 0) {
        const reader = new FileReader();
        reader.onload = (e) => setOpticalImage(e.target.result);
        reader.readAsDataURL(files[0]);
      }
    } else {
      setUploadedBatchFiles(prevFiles => {
        const combined = [...prevFiles, ...files];
        return combined.filter((v, i, a) => a.findIndex(t => t.name === v.name) === i);
      });
      if (!uploadedImage && files.length > 0) {
        const reader = new FileReader();
        reader.onload = (e) => setUploadedImage(e.target.result);
        reader.readAsDataURL(files[0]);
      }
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (!e.dataTransfer) return;

    const items = e.dataTransfer.items;
    const files = [];

    if (items) {
      const promises = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            if (entry.isFile) {
              promises.push(new Promise(res => entry.file(f => { files.push(f); res(); })));
            } else if (entry.isDirectory) {
              const dirReader = entry.createReader();
              promises.push(new Promise(res => {
                dirReader.readEntries(entries => {
                  const filePromises = entries.map(ent => new Promise(resolve => {
                    if (ent.isFile) ent.file(f => { files.push(f); resolve(); });
                    else resolve(); 
                  }));
                  Promise.all(filePromises).then(() => res());
                });
              }));
            }
          }
        }
      }
      await Promise.all(promises);
      if (files.length > 0) handleMultipleFiles(files, ingestMode);
      else alert("No valid images found in the dropped folder.");
    } else if (e.dataTransfer.files) {
      handleMultipleFiles(e.dataTransfer.files, ingestMode);
    }
  };

  const handleClearUpload = () => {
    if (ingestMode === "upload") {
      setOpticalImage(null);
      setOpticalBatchFiles([]);
      if (opticalInputRef.current) opticalInputRef.current.value = "";
      if (opticalFolderRef.current) opticalFolderRef.current.value = "";
    } else {
      setUploadedImage(null);
      setUploadedBatchFiles([]);
      setMorphologyFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (folderInputRef.current) folderInputRef.current.value = "";
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
  };

  const handleAnalyze = async () => {
    if (!isPiConnected) return alert("Raspberry Pi 5 is currently disconnected.");
    setIsAnalyzing(true);

    try {
      if (ingestMode === "camera") {
        if (!capturedImage) { alert("Capture slide frame first."); setIsAnalyzing(false); return; }
        const res = await fetch(`${API_YOLO_URL}?confidence_threshold=${yoloConfThresh}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: capturedImage })
        });
        if (!res.ok) throw new Error(`YOLO error: ${res.status}`);
        const data = await res.json();
        if (data.summary) setLatestResult(data.summary);

      } else if (ingestMode === "upload") {
        if (opticalBatchFiles.length === 0) { alert("Please upload microscope images first."); setIsAnalyzing(false); return; }
        const formData = new FormData();
        opticalBatchFiles.forEach((file) => formData.append("files", file));
        
        const res = await fetch(`${API_YOLO_BATCH_URL}?confidence_threshold=${yoloConfThresh}`, { method: "POST", body: formData });
        if (!res.ok) throw new Error(`YOLO Batch Server error: ${res.status}`);
        const data = await res.json();
        if (data.summary) setLatestResult(data.summary);

      } else {
        if (uploadedBatchFiles.length === 0) { alert("Upload FlowCAM crops first."); setIsAnalyzing(false); return; }
        const formData = new FormData();
        uploadedBatchFiles.forEach((file) => formData.append("files", file));
        if (morphologyFile) formData.append("morphology_file", morphologyFile);

        const res = await fetch(`${API_BATCH_URL}?audit_threshold=${auditThresh}`, { method: "POST", body: formData });
        if (!res.ok) throw new Error(`FlowCAM Server error: ${res.status}`);
        const data = await res.json();
        if (data.summary) setLatestResult(data.summary);
      }

      setCurrentView("result");
    } catch (err) {
      console.error(err);
      alert("Analysis execution failed on Raspberry Pi 5.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleExportCSV = () => {
    const list = latestResult?.specimens || [];
    if (!list.length) return;
    const headers = ["Filename,Predicted_Taxon,Confidence,Status,Domain,Biometrics_Source,Area_um2,Feret_Max_um,Aspect_Ratio,Circularity,Cloud_Image_URL\n"];
    const rows = list.map(s =>
      `"${s.filename || ''}","${s.prediction || ''}",${s.confidence || 0},"${s.status || ''}","${s.domain || ''}","${s.biometrics_source || 'Edge CV'}",${s.area_um2 || 0},${s.feret_max_um || 0},${s.aspect_ratio || 0},${s.circularity || 0},"${s.imageUrl || ''}"`
    );
    const blob = new Blob([...headers, ...rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `MarineAI_Specimens_${Date.now()}.csv`;
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
    doc.text(`Batch ID: ${latestResult?.sampleId || "Run"}`, 14, 34);
    doc.setFont("helvetica", "normal");
    doc.text(`Generated: ${latestResult?.timestamp || "-"} | Engine: ${latestResult?.analysisMode || "Edge AI"}`, 14, 40);

    autoTable(doc, {
      startY: 46,
      head: [["Metric", "Value", "Status"]],
      body: [
        ["Total Microorganisms", `${latestResult?.totalOrganisms || 0}`, "Cataloged"],
        ["Species Richness", `${latestResult?.speciesRichness || 0}`, "Distinct Taxa"],
        ["Shannon Diversity (H')", `${latestResult?.shannonIndex || 0}`, "Computed"],
        ["Inference Speed", `${latestResult?.processingTime || "-"}`, "Accelerated"]
      ],
      theme: "grid",
      headStyles: { fillColor: [15, 76, 129] }
    });

    const finalY = doc.lastAutoTable?.finalY || 95;
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Species Identification Register", 14, finalY + 10);

    const tableData = (Array.isArray(latestResult?.specimens) ? latestResult.specimens : []).slice(0, 60).map(s => [
      s?.filename || "-",
      s?.prediction || "-",
      `${s?.confidence || 0}%`,
      s?.status || "Verified",
      `${s?.area_um2 || 0} um2`,
      s?.biometrics_source || "Edge CV"
    ]);

    autoTable(doc, {
      startY: finalY + 14,
      head: [["File Name", "Species", "Confidence", "Status", "Area", "Source"]],
      body: tableData.length > 0 ? tableData : [["-", "No specimens in active buffer", "-", "-", "-", "-"]],
      theme: "striped",
      headStyles: { fillColor: [51, 65, 85] }
    });

    doc.save(`MarineAI_Lab_Report_${Date.now()}.pdf`);
  };

  const handleDeleteRecord = async (sampleId) => {
    if (!window.confirm(`Are you sure you want to permanently delete data for ${sampleId}?`)) return;
    try {
      const res = await fetch(`${PI_BASE_URL}/delete-record/${sampleId}`, { method: 'DELETE' });
      if (res.ok) {
        alert(`${sampleId} has been successfully deleted.`);
        fetchCloudData(); 
        if (latestResult?.sampleId === sampleId) {
            setLatestResult({
              sampleId: "No Analysis Yet", timestamp: "-", totalOrganisms: 0, speciesRichness: 0,
              avgConfidence: 0, shannonIndex: 0, phytoCount: 0, zooCount: 0, processingTime: "-",
              species: [], specimens: [], detections: [], rawImageUrl: "", annotatedImageUrl: "",
              yoloImages: [], analysisMode: "FlowCAM Dual-Branch", morphologyMode: "Auto Edge CV",
            });
        }
      } else alert('Failed to delete the record.');
    } catch (error) {
      console.error('Error:', error);
      alert('Network error while trying to delete.');
    }
  };

  const closeFullScreen = () => {
    setFullScreenImage(null);
    setImageZoom(90);
    setIsPanning(false);
  };

  const isYoloResult = (latestResult?.analysisMode === "Optical Microscope (YOLO)") || !!latestResult?.annotatedImageUrl;
  const safeSpecimens = Array.isArray(latestResult?.specimens) ? latestResult.specimens : [];
  const safeSpecies = Array.isArray(latestResult?.species) ? latestResult.species : [];
  const safeYoloImages = Array.isArray(latestResult?.yoloImages) ? latestResult.yoloImages : [];
  
  const filteredSpecimens = safeSpecimens.filter(s => {
    const matchesTaxon = (selectedTaxonFilter === "ALL") || (s?.prediction === selectedTaxonFilter);
    const matchesSearch = String(s?.filename || "").toLowerCase().includes(searchFilename.toLowerCase());
    return matchesTaxon && matchesSearch;
  });

  const filteredYoloImages = safeYoloImages.filter(img => {
    if (selectedTaxonFilter === "ALL") return true;
    const detections = Array.isArray(latestResult?.detections) ? latestResult.detections : [];
    return detections.some(d => d.source_file === img.filename && d.species === selectedTaxonFilter);
  });

  return (
    <div className="app-container">
      
      {/* FULL SCREEN IMAGE MODAL (WITH MOUSE WHEEL ZOOM & DRAG PAN) */}
      {fullScreenImage && (
        <div 
          style={{
            position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
            backgroundColor: "rgba(15, 23, 42, 0.95)", zIndex: 9999,
            display: "flex", flexDirection: "column", backdropFilter: "blur(5px)"
          }}
        >
          {/* Header Controls */}
          <div 
            style={{ 
              position: "absolute", top: "20px", right: "20px", zIndex: 10000, 
              display: "flex", gap: "10px", alignItems: "center", background: "rgba(0,0,0,0.5)", 
              padding: "8px 12px", borderRadius: "8px" 
            }}
          >
            <span style={{ color: "#94a3b8", fontSize: "12px", marginRight: "10px", fontWeight: 600 }}>Scroll to Zoom • Drag to Pan</span>
            <div style={{ width: "1px", height: "24px", background: "rgba(255,255,255,0.3)" }}></div>
            <button 
              style={{ background: "none", border: "none", color: "#fca5a5", cursor: "pointer", marginLeft: "10px" }} 
              onClick={closeFullScreen}
            >
              <XCircle size={28} />
            </button>
          </div>

          {/* Interactive Scroll & Pan Canvas */}
          <div 
            ref={scrollContainerRef}
            style={{ 
              width: "100%", height: "100%", overflow: "auto", textAlign: "center", 
              cursor: isPanning ? "grabbing" : "grab" 
            }}
            onWheel={(e) => {
              // Mouse wheel scroll to adjust zoom instantly
              setImageZoom(prev => Math.min(Math.max(prev + (e.deltaY < 0 ? 15 : -15), 30), 800));
            }}
            onMouseDown={() => setIsPanning(true)}
            onMouseUp={() => setIsPanning(false)}
            onMouseLeave={() => setIsPanning(false)}
            onMouseMove={(e) => {
              // Google Maps style Drag-to-Pan logic
              if (isPanning && scrollContainerRef.current) {
                scrollContainerRef.current.scrollLeft -= e.movementX;
                scrollContainerRef.current.scrollTop -= e.movementY;
              }
            }}
          >
            {/* CSS Trick for perfectly centering the zoomable image without cutting off corners */}
            <div style={{ display: "inline-block", minHeight: "100%", verticalAlign: "middle" }}></div>
            <img 
              src={fullScreenImage} 
              style={{ 
                height: `${imageZoom}vh`, 
                verticalAlign: "middle",
                transition: "height 0.1s ease-out", // Smooth zoom animation
                borderRadius: "4px",
                margin: "40px",
                pointerEvents: "none" // Crucial: forces click/drag events to pass through to the container
              }} 
              alt="Full Screen Inspect" 
            />
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="app-header">
        <div className="logo-group" onClick={() => setCurrentView("dashboard")}>
          <Activity size={22} color="#0f4c81" />
          <span>MARINE AI</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {isPiConnected && piTemperature !== null && (
            <span className="temp-badge">
              <Thermometer size={14} />
              <span>{piTemperature}°C</span>
            </span>
          )}
          <span className={`status-badge ${isPiConnected ? 'connected' : 'disconnected'}`}>
            <span className="status-dot"></span>
            {isPiConnected ? `Pi Online (${PI_IP})` : "Pi Disconnected"}
          </span>
          <button onClick={fetchCloudData} className="btn-secondary" style={{ padding: "5px 10px", fontSize: "12px" }}>☁️ Sync Cloud</button>
        </div>
      </header>

      {/* BODY */}
      <div className="app-body">
        <aside className="nav-sidebar">
          <div className={`nav-item ${currentView === "dashboard" ? "active" : ""}`} onClick={() => setCurrentView("dashboard")}><LayoutDashboard size={18} /> Dashboard</div>
          <div className={`nav-item ${currentView === "analysis" ? "active" : ""}`} onClick={() => setCurrentView("analysis")}><Camera size={18} /> Specimen Ingestion</div>
          <div className={`nav-item ${currentView === "result" ? "active" : ""}`} onClick={() => setCurrentView("result")}><Eye size={18} /> Taxonomic Results</div>
          <div className={`nav-item ${currentView === "history" ? "active" : ""}`} onClick={() => setCurrentView("history")}><History size={18} /> Cloud History</div>
        </aside>

        <main className="main-content">
          {/* VIEW 1: DASHBOARD */}
          {currentView === "dashboard" && (
            <div>
              <div className="page-title-section">
                <div>
                  <h1 className="page-title">Ecological & Specimen Overview</h1>
                  <p style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>Synchronized live with ThingsBoard Cloud & Dropbox CDN</p>
                </div>
                <button className="btn-primary" onClick={() => setCurrentView("analysis")}><Plus size={16} /> Start new analysis</button>
              </div>

              <div className="grid-cards">
                <div className="card"><div className="card-value">{latestResult?.totalOrganisms || 0}</div><div className="card-title">Total Microorganisms</div></div>
                <div className="card"><div className="card-value">{latestResult?.speciesRichness || 0}</div><div className="card-title">Species Richness</div></div>
                <div className="card"><div className="card-value" style={{ color: "#10b981" }}>{latestResult?.phytoCount || 0}</div><div className="card-title">Phytoplankton Count</div></div>
                <div className="card"><div className="card-value" style={{ color: "#0284c7" }}>{latestResult?.zooCount || 0}</div><div className="card-title">Zooplankton Count</div></div>
                <div className="card" style={{ borderLeft: "4px solid #0f4c81" }}><div className="card-value" style={{ color: "#0f4c81" }}>{latestResult?.shannonIndex || 0}</div><div className="card-title">Shannon Index (H')</div></div>
              </div>

              <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px" }}>
                <div>
                  <div className="eyebrow">Active Cloud Run Record</div>
                  <div style={{ fontWeight: 700, fontSize: "16px" }}>
                    {latestResult?.sampleId || "No Run Selected"} &nbsp;
                    <span style={{ fontSize: "11px", padding: "2px 8px", background: "#f1f5f9", borderRadius: "10px", color: "#475569" }}>
                      Mode: {latestResult?.analysisMode || "FlowCAM"}
                    </span>
                  </div>
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                    {(latestResult?.totalOrganisms || 0) > 0 ? `${latestResult.totalOrganisms} specimens identified. Synced at ${latestResult.timestamp}. Speed: ${latestResult.processingTime}` : "No active slide analyzed yet. Go to 'Specimen Ingestion' to start."}
                  </div>
                </div>
                <button className="btn-secondary" onClick={() => setCurrentView("result")}><Eye size={14} /> Open Results</button>
              </div>
            </div>
          )}

          {/* VIEW 2: INGESTION VIEW */}
          {currentView === "analysis" && (
            <div>
              <div className="page-title-section">
                <div>
                  <h1 className="page-title">Specimen Ingestion & Analysis</h1>
                  <p style={{ fontSize: "12px", color: "#64748b" }}>Select acquisition mode: Live Camera, Microscope Image, or FlowCAM Batch</p>
                </div>
                <div className="tab-pill-group">
                  <button className={`tab-pill ${ingestMode === "camera" ? "active" : ""}`} onClick={() => setIngestMode("camera")}>
                    <Camera size={14} /> 1. Live Pi Camera (YOLO)
                  </button>
                  <button className={`tab-pill ${ingestMode === "upload" ? "active" : ""}`} onClick={() => setIngestMode("upload")}>
                    <UploadCloud size={14} /> 2. Upload Microscope Image (YOLO)
                  </button>
                  <button className={`tab-pill ${ingestMode === "flowcam" ? "active" : ""}`} onClick={() => setIngestMode("flowcam")}>
                    <Layers size={14} /> 3. FlowCAM Batch (Dual-Mode)
                  </button>
                </div>
              </div>

              <div className="capture-layout">
                {/* Left Column */}
                <div className="card">
                  
                  {/* TAB 1: LIVE PI CAMERA */}
                  {ingestMode === "camera" && (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}><span style={{ fontWeight: 600, fontSize: "14px" }}>Optical Microscope Live Stream</span></div>
                      <div className="preview-box">
                        {capturedImage ? (
                          <div className="uploaded-preview-wrapper"><img src={capturedImage} alt="Captured Frame" className="preview-overlay-image" /><button type="button" className="dropzone-reset-btn" onClick={() => setCapturedImage(null)}><RefreshCw size={13} /> Unfreeze Live Stream</button></div>
                        ) : (
                          <img src={PI_STREAM_URL} alt="Live Optical Feed" className="preview-overlay-image" onError={(e) => { e.target.onerror = null; e.target.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360' fill='%23090d16'><text x='170' y='180' fill='%2364748b' font-family='sans-serif'>Waiting for Port 5000 Camera Stream...</text></svg>"; }} />
                        )}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "14px" }}>
                        <button type="button" className="btn-primary" onClick={handleCaptureFrame} disabled={!isPiConnected || isCapturing}><Camera size={15} /> {isCapturing ? "Grabbing Frame..." : (capturedImage ? "Recapture Slide Frame" : "Capture Slide Frame")}</button>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ fontSize: "12px", color: "#64748b" }}>YOLO Confidence:</span><input type="range" min="0.25" max="0.85" step="0.05" value={yoloConfThresh} onChange={(e) => setYoloConfThresh(parseFloat(e.target.value))} /><span style={{ fontWeight: 700, fontSize: "12px", color: "#0f4c81" }}>{Math.round(yoloConfThresh * 100)}%</span></div>
                      </div>
                    </div>
                  )}

                  {/* TAB 2: UPLOAD MICROSCOPE IMAGE */}
                  {ingestMode === "upload" && (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                        <span style={{ fontWeight: 600, fontSize: "14px" }}>Full-Frame Slide Micrograph File(s)</span>
                      </div>
                      
                      <div 
                        className={`upload-dropzone ${isDragging ? "dragging" : ""} ${opticalBatchFiles.length > 0 || opticalImage ? "has-file" : ""}`} 
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                      >
                        <input type="file" ref={opticalInputRef} style={{ display: "none" }} accept="image/*" multiple onChange={(e) => handleMultipleFiles(e.target.files, "upload")} />
                        <input type="file" ref={opticalFolderRef} style={{ display: "none" }} webkitdirectory="" directory="" multiple onChange={(e) => handleMultipleFiles(e.target.files, "upload")} />
                        
                        {isDragging ? (
                          <div className="dropzone-content">
                            <UploadCloud size={54} color="#10b981" style={{ marginBottom: "12px" }} />
                            <h3 style={{ fontSize: "18px", fontWeight: 700, color: "#10b981" }}>Drop microscope images/folders to upload!</h3>
                          </div>
                        ) : opticalBatchFiles.length > 1 ? (
                          <div className="dropzone-content">
                            <FolderOpen size={48} color="#0f4c81" style={{ marginBottom: "12px" }} />
                            <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>📁 {opticalBatchFiles.length} Micrographs Staged!</h3>
                            <p style={{ fontSize: "12px", color: "#64748b" }}>Drag more folders/images to add to batch</p>
                            <button type="button" className="btn-secondary" onClick={handleClearUpload} style={{ borderColor: "#fca5a5", color: "#b91c1c", background: "#fef2f2", marginTop: "8px" }}><XCircle size={14} /> Clear Selection</button>
                          </div>
                        ) : opticalImage ? (
                          <div className="uploaded-preview-wrapper">
                            <img src={opticalImage} alt="Optical Slide" className="uploaded-preview-img" />
                            <button type="button" className="dropzone-reset-btn" onClick={handleClearUpload}><RefreshCw size={13} /> Replace Image</button>
                          </div>
                        ) : (
                          <div className="dropzone-content">
                            <Camera size={48} color="#0f4c81" style={{ marginBottom: "12px", opacity: 0.8 }} />
                            <h4 style={{ fontSize: "15px", fontWeight: 700, marginBottom: "6px" }}>Drag & Drop microscope optical frames here</h4>
                            <p style={{ fontSize: "12px", color: "#64748b", marginBottom: "16px" }}>Runs YOLO multi-organism detection across batches</p>
                            <div style={{ display: "flex", gap: "10px" }}>
                              <button type="button" className="btn-primary" onClick={() => opticalInputRef.current?.click()}><ImageIcon size={14} /> Select Files</button>
                              <button type="button" className="btn-secondary" onClick={() => opticalFolderRef.current?.click()}><FolderOpen size={14} /> Upload Folder</button>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "14px" }}>
                        <span style={{ fontSize: "12px", color: "#64748b" }}>Sensor: Industrial 100x Objective</span>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ fontSize: "12px", color: "#64748b" }}>YOLO Confidence:</span><input type="range" min="0.25" max="0.85" step="0.05" value={yoloConfThresh} onChange={(e) => setYoloConfThresh(parseFloat(e.target.value))} /><span style={{ fontWeight: 700, fontSize: "12px", color: "#0f4c81" }}>{Math.round(yoloConfThresh * 100)}%</span></div>
                      </div>
                    </div>
                  )}

                  {/* TAB 3: FLOWCAM BATCH */}
                  {ingestMode === "flowcam" && (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                        <span style={{ fontWeight: 600, fontSize: "14px" }}>FlowCAM Crops Ingestion</span>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ fontSize: "12px", color: "#64748b" }}>Audit Cutoff:</span><input type="range" min="40" max="85" value={auditThresh} onChange={(e) => setAuditThresh(e.target.value)} /><span style={{ fontWeight: 700, fontSize: "12px", color: "#0f4c81" }}>{auditThresh}%</span></div>
                      </div>

                      <div
                        className={`upload-dropzone ${isDragging ? "dragging" : ""} ${uploadedBatchFiles.length > 0 || uploadedImage ? "has-file" : ""}`}
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                      >
                        <input type="file" ref={fileInputRef} style={{ display: "none" }} accept="image/*" multiple onChange={(e) => handleMultipleFiles(e.target.files, "flowcam")} />
                        <input type="file" ref={folderInputRef} style={{ display: "none" }} webkitdirectory="" directory="" multiple onChange={(e) => handleMultipleFiles(e.target.files, "flowcam")} />

                        {isDragging ? (
                          <div className="dropzone-content"><FolderOpen size={54} color="#10b981" style={{ marginBottom: "12px" }} /><h3 style={{ fontSize: "18px", fontWeight: 700, color: "#10b981" }}>Drop files or folder to upload!</h3></div>
                        ) : uploadedBatchFiles.length > 1 ? (
                          <div className="dropzone-content">
                            <FolderOpen size={48} color="#0f4c81" style={{ marginBottom: "12px" }} />
                            <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>📁 {uploadedBatchFiles.length} Specimen Crops Staged!</h3>
                            <p style={{ fontSize: "12px", color: "#64748b" }}>Drag more folders/images to add to batch</p>
                            <button type="button" className="btn-secondary" onClick={handleClearUpload} style={{ borderColor: "#fca5a5", color: "#b91c1c", background: "#fef2f2", marginTop: "8px" }}><XCircle size={14} /> Clear Selection</button>
                          </div>
                        ) : uploadedImage ? (
                          <div className="uploaded-preview-wrapper"><img src={uploadedImage} alt="Crop Preview" className="uploaded-preview-img" /><button type="button" className="dropzone-reset-btn" onClick={handleClearUpload}><RefreshCw size={13} /> Replace Crop</button></div>
                        ) : (
                          <div className="dropzone-content">
                            <UploadCloud size={46} color="#0f4c81" style={{ marginBottom: "12px", opacity: 0.8 }} />
                            <h4 style={{ fontSize: "15px", fontWeight: 700, marginBottom: "6px" }}>Drag & drop cropped plankton images or folder</h4>
                            <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
                              <button type="button" className="btn-primary" onClick={() => fileInputRef.current?.click()}><ImageIcon size={14} /> Select Files</button>
                              <button type="button" className="btn-secondary" onClick={() => folderInputRef.current?.click()}><FolderOpen size={14} /> Upload Folder</button>
                            </div>
                          </div>
                        )}
                      </div>

                      <div style={{ marginTop: "16px", padding: "10px 14px", background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <FileSpreadsheet size={22} color={morphologyFile ? "#15803d" : "#64748b"} />
                          <div>
                            <div style={{ fontSize: "13px", fontWeight: 600 }}>{morphologyFile ? morphologyFile.name : "Attach FlowCAM VisualSpreadsheet CSV (Optional)"}</div>
                            <div style={{ fontSize: "11px", color: "#64748b" }}>{morphologyFile ? "Hardware biometrics mapped to images" : "Auto OpenCV contour biometrics fallback if omitted"}</div>
                          </div>
                        </div>
                        <input type="file" ref={csvInputRef} style={{ display: "none" }} accept=".csv,.tsv,.txt" onChange={(e) => e.target.files && setMorphologyFile(e.target.files[0])} />
                        {morphologyFile ? (
                          <button type="button" onClick={() => { setMorphologyFile(null); if (csvInputRef.current) csvInputRef.current.value = ""; }} style={{ background: "#fee2e2", border: "1px solid #fca5a5", color: "#b91c1c", fontSize: "11px", padding: "4px 8px", borderRadius: "4px", cursor: "pointer", fontWeight: 700 }}>Remove CSV</button>
                        ) : (
                          <button type="button" className="btn-secondary" style={{ fontSize: "11px", padding: "5px 10px" }} onClick={() => csvInputRef.current?.click()}>Attach CSV</button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                  <div>
                    <h3 style={{ fontSize: "15px", fontWeight: 700, marginBottom: "10px" }}>{ingestMode === "flowcam" ? "FlowCAM Dual-Branch Engine" : "Optical Microscope YOLO Engine"}</h3>
                    <ul className="checklist">
                      {ingestMode === "camera" && (<><li><span className="step-num">1</span> Live optical feed active via Port 5000.</li><li><span className="step-num">2</span> Focus microscope lighting & click <b>Capture Slide Frame</b>.</li><li><span className="step-num">3</span> YOLO detects bounding boxes.</li></>)}
                      {ingestMode === "upload" && (<><li><span className="step-num">1</span> Drag and drop bulk full-frame microscope micrographs.</li><li><span className="step-num">2</span> YOLO runs native ONNX bounding-box inference across all frames.</li></>)}
                      {ingestMode === "flowcam" && (<><li><span className="step-num">1</span> Ingest cropped individual cells or full sample folder.</li><li><span className="step-num">2</span> Morphology: {morphologyFile ? "Hardware CSV Calibrated" : "Auto Edge CV"}.</li><li><span className="step-num">3</span> EfficientNet-B0 + 47-D MLP calculates species taxonomy.</li></>)}
                    </ul>
                  </div>

                  <button
                    className="btn-primary"
                    style={{ justifyContent: "center", padding: "12px", opacity: isPiConnected ? 1 : 0.5, cursor: isPiConnected ? "pointer" : "not-allowed" }}
                    onClick={handleAnalyze}
                    disabled={!isPiConnected || isAnalyzing}
                  >
                    <Play size={16} /> {isAnalyzing
                      ? "Inference Running on Pi 5..."
                      : (ingestMode === "flowcam" ? (uploadedBatchFiles.length > 1 ? `Execute ${uploadedBatchFiles.length} Specimens on Pi 5` : "Run FlowCAM Analysis") : 
                        (ingestMode === "upload" && opticalBatchFiles.length > 1 ? `Execute ${opticalBatchFiles.length} Microscope Frames` : "Run Detection"))}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* VIEW 3: RESULTS */}
          {currentView === "result" && (
            <div>
              <div className="page-title-section">
                <div>
                  <div className="eyebrow">Batch ID: {latestResult?.sampleId || "Active Run"} &bull; Engine: {latestResult?.analysisMode || "Edge AI"}</div>
                  <h1 className="page-title">Taxonomic Breakdown & Ecological Report</h1>
                </div>
                <div style={{ display: "flex", gap: "10px" }}>
                  {!isYoloResult && <button className="btn-secondary" onClick={handleExportCSV}><Download size={15} /> Export File-Species CSV</button>}
                  <button className="btn-primary" onClick={handleExportReport}><Download size={15} /> Export Lab PDF</button>
                </div>
              </div>

              <div className="grid-cards" style={{ marginBottom: "20px" }}>
                <div className="card"><div className="card-value">{latestResult?.totalOrganisms || 0}</div><div className="card-title">Total Microorganisms</div></div>
                <div className="card"><div className="card-value">{latestResult?.speciesRichness || 0}</div><div className="card-title">Species Richness</div></div>
                <div className="card"><div className="card-value" style={{ color: "#0f4c81" }}>{latestResult?.shannonIndex || 0}</div><div className="card-title">Shannon Index (H')</div></div>
                <div className="card"><div className="card-value">{latestResult?.processingTime || "-"}</div><div className="card-title">Inference Speed</div></div>
                <div className="card"><div className="card-value">{latestResult?.avgConfidence || 0}%</div><div className="card-title">Avg Confidence</div></div>
              </div>

              {/* YOLO GALLERY OR SINGLE DISPLAY */}
              {isYoloResult ? (
                safeYoloImages.length > 1 ? (
                  <div className="card" style={{ marginBottom: "24px" }} ref={galleryRef}>
                    <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#0f4c81", marginBottom: "14px" }}>
                      Optical Microscope Batch Gallery ({filteredYoloImages.length} of {safeYoloImages.length} Annotated Frames)
                    </h3>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px", maxHeight: "600px", overflowY: "auto", padding: "4px" }}>
                       {filteredYoloImages.map((img, idx) => (
                         <div key={idx} style={{ background: "#090d16", borderRadius: "8px", overflow: "hidden", border: "2px solid #cbd5e1", display: "flex", flexDirection: "column" }}>
                           <div style={{ padding: "10px", background: "#ffffff", color: "#0f4c81", fontSize: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #cbd5e1" }}>
                              <span style={{ fontWeight: 700, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", maxWidth: "65%" }}>📄 {img?.filename || "Slide"}</span>
                              <span style={{ background: "#e0f2fe", color: "#0369a1", padding: "4px 8px", borderRadius: "4px", fontWeight: 700 }}>{img?.organism_count || 0} Taxa</span>
                           </div>
                           <div 
                             className="preview-box" 
                             style={{ height: "260px", border: "none", borderRadius: "0", cursor: "zoom-in" }}
                             onClick={() => setFullScreenImage(img?.annotatedImageUrl)}
                           >
                             {img?.annotatedImageUrl ? <img src={img.annotatedImageUrl} className="preview-overlay-image" alt="Annotated" /> : <span style={{ color: "#64748b" }}>Loading Preview...</span>}
                           </div>
                         </div>
                       ))}
                    </div>
                  </div>
                ) : (
                  <div className="card" style={{ marginBottom: "24px" }} ref={galleryRef}>
                    <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#0f4c81", marginBottom: "14px" }}>Optical Microscope Inspection (Dropbox CDN)</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                      <div>
                        <div className="card-title">Original Micrograph Frame</div>
                        <div 
                          className="preview-box" 
                          style={{ height: "340px", cursor: "zoom-in" }}
                          onClick={() => setFullScreenImage(latestResult?.rawImageUrl)}
                        >
                          {latestResult?.rawImageUrl ? <img src={latestResult.rawImageUrl} alt="Raw Slide" className="preview-overlay-image" /> : <span style={{ color: "#64748b", fontSize: "12px" }}>Awaiting Raw Image</span>}
                        </div>
                      </div>
                      <div>
                        <div className="card-title">YOLO Annotated Bounding Box Layer</div>
                        <div 
                          className="preview-box" 
                          style={{ height: "340px", border: "2px solid #0f4c81", cursor: "zoom-in" }}
                          onClick={() => setFullScreenImage(latestResult?.annotatedImageUrl)}
                        >
                          {latestResult?.annotatedImageUrl ? <img src={latestResult.annotatedImageUrl} alt="Annotated Detections" className="preview-overlay-image" /> : <span style={{ color: "#64748b", fontSize: "12px" }}>Awaiting Detection Layer</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              ) : (
                <div className="card" style={{ marginBottom: "24px" }} ref={galleryRef}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
                    <div>
                      <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#0f4c81" }}>Cloud Specimen Gallery (Dropbox CDN)</h3>
                      <p style={{ fontSize: "12px", color: "#64748b" }}>Cells tagged with physical Area, Aspect Ratio, Feret Max & Biometrics Source</p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{ position: "relative" }}>
                        <input type="text" placeholder="Search filename..." value={searchFilename} onChange={(e) => setSearchFilename(e.target.value)} style={{ padding: "6px 12px 6px 28px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px" }} />
                        <Search size={14} color="#94a3b8" style={{ position: "absolute", left: "8px", top: "8px" }} />
                      </div>
                      <select value={selectedTaxonFilter} onChange={(e) => setSelectedTaxonFilter(e.target.value)} style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px", background: "#ffffff" }}>
                        <option value="ALL">All Taxa ({safeSpecimens.length})</option>
                        {safeSpecies.map(s => <option key={s?.name || Math.random()} value={s?.name}>{s?.name} ({s?.count})</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: "14px", maxHeight: "520px", overflowY: "auto", padding: "4px" }}>
                    {filteredSpecimens.map((spec, idx) => {
                      const isVerified = (spec?.status === "Verified");
                      const isHwBio = (spec?.biometrics_source === "Hardware CSV (FlowCAM)");
                      return (
                        <div key={idx} style={{ background: "#ffffff", border: `1px solid ${isVerified ? "#cbd5e1" : "#fcd34d"}`, borderRadius: "8px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                          <div 
                            style={{ height: "130px", background: "#090d16", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", cursor: "zoom-in" }}
                            onClick={() => setFullScreenImage(spec?.imageUrl)}
                          >
                            {spec?.imageUrl ? <img src={spec.imageUrl} alt={spec?.filename} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : <div style={{ color: "#64748b", fontSize: "11px" }}>Local Preview</div>}
                            <span style={{ position: "absolute", bottom: "6px", right: "6px", background: "rgba(0,0,0,0.75)", color: "#fff", fontSize: "10px", padding: "2px 6px", borderRadius: "4px" }}>{spec?.confidence || 0}%</span>
                            <span style={{ position: "absolute", top: "6px", left: "6px", background: isHwBio ? "rgba(16, 185, 129, 0.85)" : "rgba(30, 41, 59, 0.8)", color: "#fff", fontSize: "9px", padding: "2px 6px", borderRadius: "4px", fontWeight: 600 }}>{isHwBio ? "⚡ FlowCAM CSV" : "👁️ Edge CV"}</span>
                          </div>
                          <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: "4px", flex: 1 }}>
                            <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>📄 {spec?.filename || "Unknown"}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                              <span className={`domain-pill ${spec?.domain === "Phytoplankton" ? "phyto" : (spec?.domain === "Zooplankton" ? "zoo" : "detritus")}`}>{spec?.domain || "Unknown"}</span>
                              <strong style={{ fontSize: "13px", color: isVerified ? "#0f4c81" : "#b45309" }}>{spec?.prediction || "-"}</strong>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#94a3b8", marginTop: "6px", borderTop: "1px solid #f1f5f9", paddingTop: "6px" }}>
                              <span>Area: {spec?.area_um2 || 0} µm²</span><span>AR: {spec?.aspect_ratio || 0}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="card">
                <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#0f4c81", marginBottom: "12px" }}>Species Abundance Count by Taxon</h3>
                <div className="species-card-grid">
                  {safeSpecies.map((sp, idx) => {
                    const isSelected = selectedTaxonFilter === sp?.name;
                    return (
                      <div 
                        key={idx} 
                        className="species-pill-card"
                        style={{ 
                          cursor: "pointer", 
                          border: isSelected ? "2px solid #0f4c81" : "1px solid #e2e8f0",
                          backgroundColor: isSelected ? "#e0f2fe" : "#f8fafc",
                          transition: "all 0.2s"
                        }}
                        onClick={() => {
                          setSelectedTaxonFilter(isSelected ? "ALL" : sp?.name);
                          galleryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                      >
                        <div>
                          <span className={`domain-pill ${sp?.domain === "Phytoplankton" ? "phyto" : (sp?.domain === "Zooplankton" ? "zoo" : "detritus")}`}>{sp?.domain || "Plankton"}</span>
                          <div className="species-name" style={{ marginTop: "4px" }}>{sp?.name || "Unknown"}</div>
                        </div>
                        <div className="species-count">{sp?.count || 0}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* VIEW 4: PAST HISTORY */}
          {currentView === "history" && (
            <div>
              <div className="page-title-section">
                <div><div className="eyebrow">Cloud Database Archive</div><h1 className="page-title">Sample History & Taxonomic Audit Trail</h1></div>
                <button className="btn-secondary" onClick={fetchCloudData}>Refresh History</button>
              </div>

              <div className="card" style={{ padding: 0 }}>
                <table className="data-table">
                  <thead>
                    <tr><th>SAMPLE ID</th><th>ENGINE MODE</th><th>TIMESTAMP</th><th>COUNT</th><th>SHANNON (H')</th><th>AVG CONF</th><th style={{ textAlign: "right" }}>ACTIONS</th></tr>
                  </thead>
                  <tbody>
                    {historyList.map((run, idx) => (
                      <tr key={idx}>
                        <td style={{ fontWeight: 700, color: "#0f4c81" }}>{run?.sampleId || "Unknown"}</td>
                        <td><span style={{ fontSize: "11px", padding: "2px 6px", borderRadius: "4px", background: "#f1f5f9" }}>{run?.analysisMode || "FlowCAM"}</span></td>
                        <td style={{ color: "#64748b" }}>{run?.timestamp || "-"}</td>
                        <td><b>{run?.totalOrganisms || 0}</b></td>
                        <td>{run?.shannonIndex || 0}</td>
                        <td>{run?.avgConfidence || 0}%</td>
                        <td style={{ textAlign: "right" }}>
                          <button className="btn-secondary" style={{ padding: "4px 10px", fontSize: "11px", marginRight: "8px" }} onClick={() => { setLatestResult(run); setCurrentView("result"); }}>Inspect</button>
                          <button className="btn-secondary" style={{ padding: "4px 10px", fontSize: "11px", borderColor: "#fca5a5", color: "#b91c1c", background: "#fef2f2" }} onClick={() => handleDeleteRecord(run?.sampleId)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}