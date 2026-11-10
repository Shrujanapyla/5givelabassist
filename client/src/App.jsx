import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";
import { MultiRoiWorkspace } from "./features/workspace";
import AuthScreen from "./features/auth/AuthScreen";
import NetworkDashboard from "./features/network/NetworkDashboard";
import MecMonitor from "./features/network/MecMonitor";
import BenchmarkPanel from "./features/network/BenchmarkPanel";
import AIAnalysisPanel from "./features/ai/AIAnalysisPanel";
import DetectionOverlay from "./features/ai/DetectionOverlay";
import { frameBoxToStageRect } from "./features/ai/aiGeometry";
import RemoteVideoTile from "./features/participants/RemoteVideoTile";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? "http://localhost:3000" : window.location.origin);
const RTC_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function getSnapshotsInCaptureOrder(list = []) {
  return list.map((snapshot, index) => ({ snapshot, index }))
    .sort((a, b) => {
      const aTime = new Date(a.snapshot.metadata?.createdAt || a.snapshot.createdAt || 0).getTime() || 0;
      const bTime = new Date(b.snapshot.metadata?.createdAt || b.snapshot.createdAt || 0).getTime() || 0;
      return aTime - bTime || a.index - b.index;
    })
    .map(({ snapshot }) => snapshot);
}

function toWorkspaceRoi(snapshot, index, history = []) {
  const matchingHistory = history
    .filter(
      (entry) =>
        entry.snapshotId === snapshot.id &&
        entry.snapshot?.data?.image
    )
    .map((entry) => ({
      id: entry.historyId,
      snapshotId: snapshot.id,
      src: entry.snapshot.data.image,
      annotations: entry.snapshot.data.annotations || [],
      capturedAt:
        entry.timestamp ||
        entry.snapshot.metadata?.createdAt ||
        entry.snapshot.createdAt ||
        Date.now(),
      version: entry.snapshot.version,
    }))
    .sort(
      (a, b) =>
        new Date(b.capturedAt).getTime() -
        new Date(a.capturedAt).getTime()
    );

  // Use the backend snapshot itself if history has not arrived yet.
  const versions = matchingHistory.length
    ? matchingHistory
    : [
        {
          id: snapshot.id,
          snapshotId: snapshot.id,
          src: snapshot.data?.image || snapshot.image || '',
          annotations: snapshot.data?.annotations || [],
          capturedAt:
            snapshot.metadata?.createdAt ||
            snapshot.createdAt ||
            Date.now(),
          version: snapshot.version,
        },
      ];

  const currentVersion = versions.find(
    (version) => version.version === snapshot.version
  );

  return {
    id: snapshot.id,
    backendId: snapshot.id,
    label: `ROI ${index + 1}`,
    snapshots: versions,
    activeSnapshotId: currentVersion?.id || versions[0]?.id,
    backendVersion: snapshot.version,
  };
}

export default function App() {
  const [authState, setAuthState] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [role, setRole] = useState("student");
  const [sessionCode, setSessionCode] = useState("");
  const [activeSession, setActiveSession] = useState("");
  const [connection, setConnection] = useState("Connecting...");
  const [participants, setParticipants] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [socket, setSocket] = useState(null);

  const [localStream, setLocalStream] = useState(null);
  const [cameraFacingMode, setCameraFacingMode] = useState("user");
  const [cameraSwitching, setCameraSwitching] = useState(false);
  const [remoteStream, setRemoteStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [peerConnections, setPeerConnections] = useState([]);
  const [activePeerId, setActivePeerId] = useState(null);
  const [aiDetections, setAiDetections] = useState([]);
  const [cameraError, setCameraError] = useState("");
  const [isDrawing, setIsDrawing] = useState(false);
  const [annotations, setAnnotations] = useState([]);
  const [selectedColor, setSelectedColor] = useState("#ff3333");
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotHistory, setSnapshotHistory] = useState([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [selectionRect, setSelectionRect] = useState(null);

  const peerRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map());
  const activePeerIdRef = useRef(null);
  const activeSessionRef = useRef("");
  const workspaceRef = useRef(null);
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const selectionStartRef = useRef(null);

  // Restore a previously authenticated browser session. Access tokens are short-lived and
  // are kept in sessionStorage so closing the browser requires another sign-in.
  useEffect(() => {
    let cancelled = false;
    async function restoreAuthentication() {
      const token = sessionStorage.getItem("5g-live-lab-token");
      if (!token) {
        if (!cancelled) setAuthReady(true);
        return;
      }
      try {
        const response = await fetch(`${SERVER_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message || "Session expired");
        if (!cancelled) {
          setAuthState({ token, user: data.user });
          setRole(data.user.role);
        }
      } catch {
        sessionStorage.removeItem("5g-live-lab-token");
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    }
    restoreAuthentication();
    return () => { cancelled = true; };
  }, []);

  const handleAuthenticated = useCallback((nextAuth) => {
    setAuthState(nextAuth);
    setRole(nextAuth.user.role);
    setAuthReady(true);
  }, []);

  const registerPeer = useCallback((remoteSocketId, pc, participant = {}) => {
    peerConnectionsRef.current.set(remoteSocketId, pc);
    if (!peerRef.current) peerRef.current = pc;
    setPeerConnections((previous) => [
      ...previous.filter((peer) => peer.socketId !== remoteSocketId),
      {
        socketId: remoteSocketId,
        participantId: participant.userId || remoteSocketId,
        displayName: participant.displayName || participant.role || "Student",
        connection: pc,
      },
    ]);
  }, []);

  const closePeer = useCallback((remoteSocketId) => {
    const pc = peerConnectionsRef.current.get(remoteSocketId);
    if (pc) pc.close();
    peerConnectionsRef.current.delete(remoteSocketId);
    pendingCandidatesRef.current.delete(remoteSocketId);
    if (peerRef.current === pc) peerRef.current = peerConnectionsRef.current.values().next().value || null;
    setPeerConnections((previous) => previous.filter((peer) => peer.socketId !== remoteSocketId));
    setRemoteStreams((previous) => {
      const next = { ...previous };
      delete next[remoteSocketId];
      if (activePeerIdRef.current === remoteSocketId) {
        const first = Object.entries(next)[0];
        activePeerIdRef.current = first?.[0] || null;
        setActivePeerId(first?.[0] || null);
        setRemoteStream(first?.[1] || null);
      }
      return next;
    });
  }, []);

  const closeAllPeers = useCallback(() => {
    for (const pc of peerConnectionsRef.current.values()) pc.close();
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
    peerRef.current = null;
    activePeerIdRef.current = null;
    setPeerConnections([]);
    setRemoteStreams({});
    setActivePeerId(null);
    setRemoteStream(null);
  }, []);

  // --------------------------------------------------
  // WEBRTC HELPERS (declared before effects that depend on them)
  // --------------------------------------------------
  const configurePeer = useCallback((pc, activeSocket, remoteSocketId, participant = {}) => {
    pc.onicecandidate = (event) => {
      if (event.candidate) activeSocket.emit("webrtc-ice-candidate", { targetSocketId: remoteSocketId, candidate: event.candidate });
    };

    pc.ontrack = (event) => {
      const stream = event.streams?.[0];
      if (!stream) return;
      setRemoteStreams((previous) => ({ ...previous, [remoteSocketId]: stream }));
      if (!activePeerIdRef.current) {
        activePeerIdRef.current = remoteSocketId;
        setActivePeerId(remoteSocketId);
        setRemoteStream(stream);
      } else if (activePeerIdRef.current === remoteSocketId) {
        setRemoteStream(stream);
      }
      setMessage(`${participant.displayName || "Student"} video is available.`);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") setMessage(`${participant.displayName || "Participant"} video connected.`);
      else if (pc.connectionState === "failed") setMessage(`Video connection failed for ${participant.displayName || "a participant"}. A TURN server may be required on restrictive networks.`);
    };
  }, []);

  const flushCandidates = useCallback(async (pc, remoteSocketId) => {
    const candidates = pendingCandidatesRef.current.get(remoteSocketId) || [];
    pendingCandidatesRef.current.delete(remoteSocketId);
    for (const candidate of candidates) {
      try { await pc.addIceCandidate(candidate); }
      catch (error) { console.error("Could not add queued ICE candidate:", error); }
    }
  }, []);

  // --------------------------------------------------
  // SOCKET CONNECTION (authenticated)
  // --------------------------------------------------
  useEffect(() => {
    if (!authReady || !authState?.token) {
      setSocket(null);
      setConnection(authReady ? "Sign in required" : "Checking sign-in...");
      return undefined;
    }

    const newSocket = io(SERVER_URL, { auth: { token: authState.token } });
    newSocket.on("connect", () => {
      setSocket(newSocket);
      setConnection("Connected");
      // Socket.IO assigns a new socket ID after reconnect. Rejoin the active room so
      // membership, participant lists and snapshot events are restored server-side.
      if (activeSessionRef.current) {
        newSocket.emit("join-session", { code: activeSessionRef.current });
      }
    });
    newSocket.on("disconnect", () => {
      setSocket(null);
      setConnection("Disconnected");
      closeAllPeers();
    });
    newSocket.on("connect_error", (error) => {
      setConnection("Connection failed");
      setMessage(error.message || "Could not authenticate the real-time connection.");
    });

    newSocket.on("session-joined", (data) => {
      activeSessionRef.current = data.code;
      setParticipants(data.participants || []);
      setActiveSession(data.code);
      setSnapshots(data.snapshots || []);
      setSnapshotHistory([]);
      newSocket.emit("snapshot:history:request");
      setMessage(`Joined session ${data.code} as ${data.role}.`);
    });

    newSocket.on("participant-joined", (participant) => {
      setParticipants((previous) => previous.some((p) => p.socketId === participant.socketId)
        ? previous : [...previous, participant]);
      setMessage(`${participant.displayName || participant.role} joined your session.`);
    });

    newSocket.on("participant-left", ({ socketId }) => {
      setParticipants((previous) => previous.filter((p) => p.socketId !== socketId));
      closePeer(socketId);
      setMessage("A participant left the session.");
    });

    newSocket.on("session-error", (data) => {
      const errorMessage = data.message || "Could not join the session.";
      setMessage(errorMessage);
      if (/not found|expired/i.test(errorMessage)) {
        activeSessionRef.current = "";
        setActiveSession("");
        setParticipants([]);
      }
    });

    newSocket.on("snapshot:created", ({ snapshot, historyEntry } = {}) => {
      if (!snapshot) return;
      setSnapshots((previous) => previous.some((item) => item.id === snapshot.id)
        ? previous.map((item) => item.id === snapshot.id ? snapshot : item)
        : [snapshot, ...previous]);
      if (historyEntry) setSnapshotHistory((previous) => [...previous, historyEntry]);
    });

    newSocket.on("snapshot:updated", ({ snapshot, historyEntry } = {}) => {
      if (!snapshot) return;
      setSnapshots((previous) => previous.some((item) => item.id === snapshot.id)
        ? previous.map((item) => item.id === snapshot.id ? snapshot : item)
        : [snapshot, ...previous]);
      if (historyEntry) setSnapshotHistory((previous) => [...previous, historyEntry]);
    });

    newSocket.on("snapshot:deleted", ({ snapshotId, historyEntry } = {}) => {
      if (!snapshotId) return;
      setSnapshots((previous) => previous.filter((item) => item.id !== snapshotId));
      if (historyEntry) setSnapshotHistory((previous) => [...previous, historyEntry]);
    });

    newSocket.on("snapshot:history", ({ history } = {}) => setSnapshotHistory(history || []));
    newSocket.on("snapshot:error", ({ message: errorMessage } = {}) => setMessage(errorMessage || "Snapshot operation failed."));
    newSocket.on("snapshot:conflict", ({ message: conflictMessage } = {}) => setMessage(conflictMessage || "This snapshot changed elsewhere."));
    newSocket.on("annotation-update", ({ annotation } = {}) => {
      if (annotation) setAnnotations((previous) => [...previous, annotation]);
    });
    newSocket.on("annotation-clear", () => setAnnotations([]));
    newSocket.on("ai:detections", (payload = {}) => {
      if (Array.isArray(payload.detections)) setAiDetections(payload.detections);
    });

    // The professor receives one targeted offer per student and maintains one peer connection per student.
    newSocket.on("webrtc-offer", async ({ offer, fromSocketId, participant } = {}) => {
      try {
        if (!offer || !fromSocketId) return;
        closePeer(fromSocketId);
        const pc = new RTCPeerConnection(RTC_CONFIG);
        registerPeer(fromSocketId, pc, participant || {});
        configurePeer(pc, newSocket, fromSocketId, participant || {});
        await pc.setRemoteDescription(offer);
        await flushCandidates(pc, fromSocketId);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        newSocket.emit("webrtc-answer", { targetSocketId: fromSocketId, answer: pc.localDescription });
      } catch (error) {
        console.error("Could not handle WebRTC offer:", error);
        setMessage("Could not establish a student video. Check the browser console.");
      }
    });

    newSocket.on("webrtc-answer", async ({ answer, fromSocketId } = {}) => {
      try {
        const pc = peerConnectionsRef.current.get(fromSocketId);
        if (!pc || !answer) return;
        await pc.setRemoteDescription(answer);
        await flushCandidates(pc, fromSocketId);
      } catch (error) {
        console.error("Could not handle WebRTC answer:", error);
      }
    });

    newSocket.on("webrtc-ice-candidate", async ({ candidate, fromSocketId } = {}) => {
      if (!candidate || !fromSocketId) return;
      const pc = peerConnectionsRef.current.get(fromSocketId);
      if (!pc || !pc.remoteDescription) {
        const pending = pendingCandidatesRef.current.get(fromSocketId) || [];
        pending.push(candidate);
        pendingCandidatesRef.current.set(fromSocketId, pending);
        return;
      }
      try { await pc.addIceCandidate(candidate); }
      catch (error) { console.error("Could not add ICE candidate:", error); }
    });

    return () => {
      newSocket.removeAllListeners();
      newSocket.disconnect();
      closeAllPeers();
    };
  }, [authReady, authState?.token, closePeer, closeAllPeers, registerPeer, configurePeer, flushCandidates]);

  // Keep the multi-ROI workspace synchronized with backend snapshots/history.
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace || !activeSession) return;

    const currentIds = new Set(snapshots.map((snapshot) => snapshot.id));

    workspace.getRois().forEach((roi) => {
      if (roi.backendId && !currentIds.has(roi.backendId)) {
        workspace.removeRoi(roi.id);
      }
    });

    getSnapshotsInCaptureOrder(snapshots).forEach((snapshot, index) => {
      workspace.upsertRoi(toWorkspaceRoi(snapshot, index, snapshotHistory));
    });
  }, [activeSession, snapshots, snapshotHistory]);

  // --------------------------------------------------
  // WEBRTC HELPERS AND MULTI-STUDENT STAR TOPOLOGY
  // --------------------------------------------------


  // Every student publishes one stream to the session professor. The professor receives
  // each student's offer separately; this is a small-group star/mesh topology, not an SFU.
  useEffect(() => {
    if (role !== "student" || !activeSession || !localStream || !socket?.connected) return undefined;
    const professor = participants.find((person) => person.role === "professor");
    if (!professor?.socketId || peerConnectionsRef.current.has(professor.socketId)) return undefined;
    let cancelled = false;

    async function startCall() {
      try {
        const pc = new RTCPeerConnection(RTC_CONFIG);
        registerPeer(professor.socketId, pc, professor);
        configurePeer(pc, socket, professor.socketId, professor);
        localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (cancelled) { closePeer(professor.socketId); return; }
        socket.emit("webrtc-offer", { targetSocketId: professor.socketId, offer: pc.localDescription });
        setMessage("Calling the session professor...");
      } catch (error) {
        console.error("Could not start WebRTC call:", error);
        setMessage("Could not start video. Check the browser console.");
      }
    }
    startCall();
    return () => { cancelled = true; };
  }, [role, activeSession, localStream, socket, participants, registerPeer, configurePeer, closePeer]);

  const handleAIDetections = useCallback((detections) => setAiDetections(detections), []);

  // --------------------------------------------------
  // CAMERA FUNCTIONS
  // --------------------------------------------------
  async function startCamera() {
    setCameraError("");

    // Camera and microphone access require a secure browser context (HTTPS,
    // or localhost). Show a useful message instead of calling an unavailable API.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        "Camera and microphone require a secure HTTPS connection. Open the HTTPS application URL to enable them."
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "user" } },
        audio: true,
      });
      setLocalStream(stream);
      setCameraFacingMode("user");
    } catch (error) {
      setCameraError(
        error.name === "NotAllowedError"
          ? "Camera or microphone permission was denied. Allow access in Chrome."
          : `Could not access camera: ${error.message}`
      );
    }
  }

// Switch between front and rear cameras while keeping the session alive.
  async function switchCamera() {
    if (!localStream || cameraSwitching) return;

    const nextFacingMode = cameraFacingMode === "user"
      ? "environment"
      : "user";

    let replacementStream = null;
    setCameraSwitching(true);
    setCameraError("");

    try {
      replacementStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: nextFacingMode } },
        audio: false,
      });

      const nextVideoTrack = replacementStream.getVideoTracks()[0];

      if (!nextVideoTrack) {
        throw new Error("Selected camera did not provide a video track.");
      }

      const previousVideoTrack = localStream.getVideoTracks()[0];

      const videoSenders = Array.from(peerConnectionsRef.current.values())
        .flatMap(pc => pc.getSenders())
        .filter(sender => sender.track?.kind === "video");

      const replacedSenders = [];

      try {
        for (const sender of videoSenders) {
          await sender.replaceTrack(nextVideoTrack);
          replacedSenders.push(sender);
        }
      } catch (error) {
        if (previousVideoTrack) {
          await Promise.all(
            replacedSenders.map(sender =>
              sender.replaceTrack(previousVideoTrack).catch(() => {})
            )
          );
        }
        throw error;
      }

      const updatedStream = new MediaStream([
        ...localStream.getAudioTracks(),
        nextVideoTrack,
      ]);

      setLocalStream(updatedStream);
      setCameraFacingMode(nextFacingMode);
      previousVideoTrack?.stop();

      setMessage(
        nextFacingMode === "environment"
          ? "Switched to the rear camera."
          : "Switched to the front camera."
      );

      replacementStream = null;
    } catch (error) {
      replacementStream?.getTracks().forEach(track => track.stop());

      setCameraError(
        error.name === "NotAllowedError"
          ? "Camera permission was denied."
          : `Could not switch camera: ${error.message}`
      );
    } finally {
      setCameraSwitching(false);
    }
  }
  function stopCamera() {
    localStream?.getTracks().forEach((track) => track.stop());
    setLocalStream(null);
    closeAllPeers();
  }

  // --------------------------------------------------
  // ANNOTATION AND ROI POINTER HELPERS
  // --------------------------------------------------
  function getCanvasPoint(event) {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }

  function startDrawing(event) {
    if (isCapturing && role === "professor") {
      startRegionSelection(event);
      return;
    }

    if (!isDrawing || role !== "professor") return;

    const canvas = canvasRef.current;
    const point = getCanvasPoint(event);
    if (!canvas || !point) return;

    drawingRef.current = true;
    lastPointRef.current = point;
    canvas.setPointerCapture(event.pointerId);

    const annotation = { from: point, to: point, color: selectedColor };
    setAnnotations((previous) => [...previous, annotation]);
    socket?.emit("annotation-update", { annotation });
  }

  function continueDrawing(event) {
    if (isCapturing && selectionStartRef.current) {
      updateRegionSelection(event);
      return;
    }

    if (!drawingRef.current || role !== "professor") return;

    const point = getCanvasPoint(event);
    if (!point) return;

    const annotation = {
      from: lastPointRef.current,
      to: point,
      color: selectedColor,
    };

    lastPointRef.current = point;
    setAnnotations((previous) => [...previous, annotation]);
    socket?.emit("annotation-update", { annotation });
  }

  function stopDrawing(event) {
    if (isCapturing && selectionStartRef.current) {
      const start = selectionStartRef.current;
      const point = getCanvasPoint(event);
      selectionStartRef.current = null;

      if (!point) {
        setMessage("Could not read the selected region. Please try again.");
        return;
      }

      const finalRect = {
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        width: Math.abs(point.x - start.x),
        height: Math.abs(point.y - start.y),
      };

      setSelectionRect(finalRect);
      saveSnapshot(finalRect);
      return;
    }

    drawingRef.current = false;
    lastPointRef.current = null;
  }

  function startRegionSelection(event) {
    if (role !== "professor" || !isCapturing || !remoteStream) return;

    const point = getCanvasPoint(event);
    if (!point) return;

    selectionStartRef.current = point;
    setSelectionRect({ x: point.x, y: point.y, width: 0, height: 0 });
    canvasRef.current?.setPointerCapture(event.pointerId);
  }

  function updateRegionSelection(event) {
    const start = selectionStartRef.current;
    const point = getCanvasPoint(event);
    if (!start || !point) return;

    setSelectionRect({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
  }

  function beginCaptureMode() {
    if (!remoteStream || !videoRef.current) {
      setMessage("Wait for a student video before capturing a region.");
      return;
    }

    setIsDrawing(false);
    drawingRef.current = false;
    setSelectionRect(null);
    selectionStartRef.current = null;
    setIsCapturing(true);
    setMessage("Drag over the live video. The region saves automatically when you release the mouse.");
  }

  function cancelCaptureMode() {
    setIsCapturing(false);
    setSelectionRect(null);
    selectionStartRef.current = null;
    setMessage("Region capture cancelled.");
  }

  function saveSnapshot(selectedRect = selectionRect) {
    const video = videoRef.current;
    const stage = canvasRef.current;

    if (!video || !stage || !selectedRect || video.readyState < 2) {
      setMessage("Select a region on the live video before saving.");
      return false;
    }

    if (selectedRect.width < 0.01 || selectedRect.height < 0.01) {
      setMessage("The selected region is too small. Drag a larger rectangle.");
      return false;
    }

    if (!socket?.connected || !activeSession) {
      setMessage("Join a session before saving a snapshot.");
      return false;
    }

    // Convert the selected display rectangle to source-video pixels.
    // This accounts for object-fit: cover, including any cropped edges.
    const stageRect = stage.getBoundingClientRect();
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    if (!videoWidth || !videoHeight || !stageRect.width || !stageRect.height) {
      setMessage("The video is not ready to capture yet.");
      return false;
    }

    const scale = Math.max(
      stageRect.width / videoWidth,
      stageRect.height / videoHeight
    );
    const renderedWidth = videoWidth * scale;
    const renderedHeight = videoHeight * scale;
    const offsetX = (renderedWidth - stageRect.width) / 2;
    const offsetY = (renderedHeight - stageRect.height) / 2;

    let sx = (selectedRect.x * stageRect.width + offsetX) / scale;
    let sy = (selectedRect.y * stageRect.height + offsetY) / scale;
    let sw = (selectedRect.width * stageRect.width) / scale;
    let sh = (selectedRect.height * stageRect.height) / scale;

    sx = Math.max(0, Math.min(videoWidth, sx));
    sy = Math.max(0, Math.min(videoHeight, sy));
    sw = Math.min(sw, videoWidth - sx);
    sh = Math.min(sh, videoHeight - sy);

    const cropWidth = Math.floor(sw);
    const cropHeight = Math.floor(sh);

    if (cropWidth < 2 || cropHeight < 2) {
      setMessage(
        "The selected region is outside the visible video. Please select again."
      );
      return false;
    }

    const output = document.createElement("canvas");
    output.width = cropWidth;
    output.height = cropHeight;

    const context = output.getContext("2d");
    if (!context) {
      setMessage("Could not create the snapshot. Please try again.");
      return false;
    }

    context.drawImage(
      video,
      sx,
      sy,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight
    );

    const image = output.toDataURL("image/png");

    socket.emit("snapshot:create", {
      data: { image },
      metadata: {
        width: cropWidth,
        height: cropHeight,
        createdAt: new Date().toLocaleTimeString(),
      },
    });

    setIsCapturing(false);
    setSelectionRect(null);
    selectionStartRef.current = null;
    setMessage("Snapshot sent to the shared workspace.");
    return true;
  }

  function captureSuggestedRoi(detection) {
    const video = videoRef.current;
    const stage = stageRef.current;
    if (!video || !stage || video.readyState < 2) {
      setMessage("Wait for the selected student's video before capturing an AI-suggested ROI.");
      return;
    }
    const rectangle = frameBoxToStageRect(
      detection?.box,
      video.videoWidth,
      video.videoHeight,
      stage.clientWidth,
      stage.clientHeight
    );
    if (!rectangle) {
      setMessage("That detection is outside the currently visible video area.");
      return;
    }
    if (!saveSnapshot(rectangle)) return;
    setMessage(`AI-suggested ROI captured: ${detection.label || "detected object"}. Review it in the shared workspace.`);
  }

  function uploadWorkspaceImage({ image, fileName, fileType }) {
    if (role !== "professor") {
      setMessage("Only the professor can upload shared ROI images.");
      return;
    }
    if (!socket?.connected || !activeSession) {
      setMessage("Join a session before uploading a shared image.");
      return;
    }
    socket.emit("snapshot:create", {
      data: { image },
      metadata: {
        source: "workspace-upload",
        fileName,
        fileType,
        createdAt: new Date().toISOString(),
      },
    });
    setMessage(`Uploading ${fileName} to the shared workspace...`);
  }

  function updateWorkspaceSnapshot(roi, active, annotations) {
    if (role !== "professor") {
      setMessage("Only the professor can annotate shared snapshots.");
      return;
    }
    if (!socket?.connected || !activeSession) {
      setMessage("Join a session before updating a snapshot.");
      return;
    }
    if (!roi?.backendId || !active?.snapshotId || !Number.isInteger(active.version)) {
      setMessage("Could not identify the current snapshot version.");
      return;
    }

    socket.emit("snapshot:update", {
      snapshotId: roi.backendId,
      data: {
        image: active.src,
        annotations: Array.isArray(annotations) ? annotations : [],
      },
      expectedVersion: active.version,
    });
    setMessage("Saving snapshot annotations...");
  }

  function restoreWorkspaceSnapshot(roi, version) {
    if (!socket?.connected || !activeSession) {
      setMessage("Join a session before restoring a snapshot.");
      return;
    }

    if (!version?.id || !roi?.backendId) {
      setMessage("Could not identify the snapshot version.");
      return;
    }

    socket.emit("snapshot:restore", { historyId: version.id });
    setMessage("Restoring snapshot version...");
  }

  function removeWorkspaceRoi(roi) {
    if (!roi.backendId) {
      workspaceRef.current?.removeRoi(roi.id);
      return;
    }

    if (!socket?.connected || !activeSession) {
      setMessage("Join a session before removing a snapshot.");
      return;
    }

    socket.emit("snapshot:delete", {
      snapshotId: roi.backendId,
    });
  }

  function clearAnnotations() {
    setAnnotations([]);
    socket?.emit("annotation-clear");
  }

  // --------------------------------------------------
  // DRAW ANNOTATIONS ON CANVAS
  // --------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = rect.width * pixelRatio;
    canvas.height = rect.height * pixelRatio;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";

    annotations.forEach((annotation) => {
      context.beginPath();
      context.strokeStyle = annotation.color;
      context.moveTo(
        annotation.from.x * rect.width,
        annotation.from.y * rect.height
      );
      context.lineTo(
        annotation.to.x * rect.width,
        annotation.to.y * rect.height
      );
      context.stroke();
    });
  }, [annotations, role, remoteStream, localStream]);

  // --------------------------------------------------
  // SESSION FUNCTIONS
  // --------------------------------------------------
  async function createSession() {
    setLoading(true);
    setMessage("");
    setParticipants([]);
    activeSessionRef.current = "";
    setActiveSession("");
    setAnnotations([]);
    setSnapshots([]);
    setSnapshotHistory([]);

    try {
      const response = await fetch(`${SERVER_URL}/api/sessions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authState.token}` },
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not create session.");
      }

      setSessionCode(data.session.code);
      socket.emit("join-session", { code: data.session.code });
      setMessage("Session created. Joining its room...");
    } catch (error) {
      setMessage(error.message || "Could not connect to the backend.");
    } finally {
      setLoading(false);
    }
  }

  async function joinSession(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setParticipants([]);
    activeSessionRef.current = "";
    setActiveSession("");
    setAnnotations([]);
    setSnapshots([]);
    setSnapshotHistory([]);

    try {
      const code = sessionCode.trim().toUpperCase();
      const response = await fetch(`${SERVER_URL}/api/sessions/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authState.token}` },
        body: JSON.stringify({ code }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not join the session.");
      }

      socket.emit("join-session", { code: data.session.code });
    } catch (error) {
      setMessage(error.message || "Could not connect to the backend.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    try {
      if (authState?.token) {
        await fetch(`${SERVER_URL}/api/auth/logout`, {
          method: "POST", headers: { Authorization: `Bearer ${authState.token}` },
        });
      }
    } catch { /* Local sign-out still proceeds when the server is unavailable. */ }
    localStream?.getTracks().forEach((track) => track.stop());
    setLocalStream(null);
    closeAllPeers();
    socket?.disconnect();
    sessionStorage.removeItem("5g-live-lab-token");
    setAuthState(null);
    activeSessionRef.current = "";
    setActiveSession("");
    setParticipants([]);
    setSnapshots([]);
    setSnapshotHistory([]);
    setAnnotations([]);
    setAiDetections([]);
    setMessage("You have signed out.");
  }

  function selectPeer(socketId) {
    activePeerIdRef.current = socketId;
    setActivePeerId(socketId);
    setRemoteStream(remoteStreams[socketId] || null);
  }

  // --------------------------------------------------
  // VIDEO VIEW
  // --------------------------------------------------
  function renderVideo() {
    const stream = role === "student" ? localStream : remoteStream;

    return (
      <div className="video-stage" ref={stageRef}>
        {stream ? (
          <video
            autoPlay
            playsInline
            muted={role === "student"}
            ref={(element) => {
              videoRef.current = element;
              if (element && element.srcObject !== stream) {
                element.srcObject = stream;
              }
            }}
          />
        ) : (
          <div className="video-placeholder">
            {role === "student"
              ? "Your camera preview will appear here."
              : "Student video will appear here after the WebRTC connection."}
          </div>
        )}

        <canvas
          ref={canvasRef}
          className="annotation-canvas"
          onPointerDown={startDrawing}
          onPointerMove={continueDrawing}
          onPointerUp={stopDrawing}
          onPointerCancel={(event) => {
            if (isCapturing) {
              selectionStartRef.current = null;
              setSelectionRect(null);
              setIsCapturing(false);
              setMessage("Region capture cancelled.");
            } else {
              stopDrawing(event);
            }
          }}
          onLostPointerCapture={stopDrawing}
          style={{
            pointerEvents:
              role === "professor" && (isDrawing || isCapturing)
                ? "auto"
                : "none",
            cursor: isCapturing
              ? "crosshair"
              : isDrawing
                ? "crosshair"
                : "default",
          }}
        />

        {role === "professor" && aiDetections.length > 0 && (
          <DetectionOverlay detections={aiDetections} videoRef={videoRef} stageRef={stageRef} />
        )}
        {selectionRect && (
          <div
            className="roi-selection"
            style={{
              left: `${selectionRect.x * 100}%`,
              top: `${selectionRect.y * 100}%`,
              width: `${selectionRect.width * 100}%`,
              height: `${selectionRect.height * 100}%`,
            }}
          />
        )}
      </div>
    );
  }

  // --------------------------------------------------
  // MAIN UI
  // --------------------------------------------------
  if (!authReady || !authState?.user) {
    return <AuthScreen serverUrl={SERVER_URL} onAuthenticated={handleAuthenticated} />;
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand-mark">5G</div>
        <div>
          <h1>Live Lab Assist</h1>
          <p>Real-time remote laboratory collaboration</p>
        </div>
        <div className="topbar-account">
          <span className={`status ${connection === "Connected" ? "online" : ""}`}>
            <span className="status-dot" />{connection}
          </span>
          <span className="account-name">{authState.user.displayName} · {authState.user.role}</span>
          <button type="button" className="secondary-button signout-button" onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      <nav className="lab-navigation" aria-label="Main navigation">
        <a href="#overview">Overview</a><a href="#laboratory">Live laboratory</a><a href="#mec-monitor">5G &amp; Edge monitoring</a>
        {role === 'professor' && <a href="#benchmark">MEC benchmark</a>}<a href="#workspace">Shared workspace</a>
      </nav>

      <section className="hero" id="overview">
        <p className="eyebrow">REMOTE LABORATORY</p>
        <h2>Learn, guide, and solve together.</h2>
        <p>
          Connect a student's live lab view with a professor's guidance and a
          shared workspace.
        </p>
      </section>

      <section className="panel">
        <h2>Get started</h2>
        <p className="muted">Your assigned account role determines the available session actions.</p>

        <div className="account-role-note">
          Signed in as <strong>{authState.user.displayName}</strong> ({role}). Your account role is enforced by the backend.
        </div>

        {role === "professor" ? (
          <div className="action-area">
            <button
              className="primary-button"
              onClick={createSession}
              disabled={loading || !socket?.connected}
            >
              {loading ? "Creating..." : "Create session"}
            </button>
          </div>
        ) : (
          <form className="action-area" onSubmit={joinSession}>
            <label htmlFor="sessionCode">Session code</label>
            <input
              id="sessionCode"
              value={sessionCode}
              onChange={(event) =>
                setSessionCode(event.target.value.toUpperCase())
              }
              placeholder="Enter the professor's code"
              maxLength={32}
              required
            />
            <button
              className="primary-button"
              type="submit"
              disabled={loading || !socket?.connected}
            >
              {loading ? "Joining..." : "Join session"}
            </button>
          </form>
        )}

        {message && (
          <p className="message" role="status">
            {message}
          </p>
        )}

        {activeSession && (
          <div className="session-card">
            <span className="muted">Session code</span>
            <strong className="session-code">{activeSession}</strong>

            {role === "professor" && (
              <button
                className="secondary-button"
                onClick={async () => {
                  const code = String(activeSession);

                  try {
                    if (window.isSecureContext && navigator.clipboard?.writeText) {
                      await navigator.clipboard.writeText(code);
                    } else {
                      // Fallback for the current HTTP campus test deployment.
                      const textarea = document.createElement("textarea");
                      textarea.value = code;
                      textarea.setAttribute("readonly", "");
                      textarea.style.position = "fixed";
                      textarea.style.left = "-9999px";
                      document.body.appendChild(textarea);
                      textarea.select();

                      const copied = document.execCommand("copy");
                      textarea.remove();

                      if (!copied) {
                        window.prompt("Copy your session code:", code);
                        return;
                      }
                    }

                    setMessage("Session code copied successfully!");
                  } catch (error) {
                    window.prompt("Copy your session code:", code);
                  }
                }}
              >
                Copy session code
              </button>
            )}

            <h3>Participants in this room ({participants.length + 1})</h3>
            <ul>
              <li>{authState.user.displayName} · {role} (you)</li>
              {participants.map((participant) => (
                <li key={participant.socketId}>
                  {participant.displayName || (participant.role === "professor" ? "Professor" : "Student")} · {participant.role}
                </li>
              ))}
            </ul>
            {role === "professor" && <p className="muted">Up to 3 students can publish individual camera feeds in this demo session.</p>}
          </div>
        )}
      </section>

    <section className="panel camera-panel" id="laboratory">
        <h2>Live camera</h2>
        <p className="muted">
          The student shares video after joining a session.
        </p>

        {role === "student" && (
          <div className="action-area">
            {!localStream ? (
              <button className="primary-button" onClick={startCamera}>
                Enable camera and microphone
              </button>
            ) : (
              <>
                <button className="secondary-button" onClick={stopCamera}>
                  Stop camera
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={switchCamera}
                  disabled={cameraSwitching}
                >
                  {cameraSwitching
                    ? "Switching camera..."
                    : cameraFacingMode === "user"
                      ? "Switch to rear camera"
                      : "Switch to front camera"}
                </button>
              </>
            )}

            {cameraError && (
              <p className="message" role="alert">
                {cameraError}
              </p>
            )}
          </div>
        )}

        {role === "professor" && (
          <div>
            <h3>Student's live video</h3>
            <div className="annotation-toolbar">
              <button
                type="button"
                onClick={() => {
                  setIsCapturing(false);
                  setSelectionRect(null);
                  setIsDrawing((previous) => !previous);
                }}
                disabled={!remoteStream}
              >
                {isDrawing ? "Stop drawing" : "Start drawing"}
              </button>

              <input
                type="color"
                value={selectedColor}
                onChange={(event) => setSelectedColor(event.target.value)}
                aria-label="Drawing color"
              />

              <button type="button" onClick={clearAnnotations}>
                Clear drawings
              </button>

              <button
                type="button"
                onClick={beginCaptureMode}
                disabled={!remoteStream}
              >
                Capture region
              </button>

              {isCapturing && (
                <button type="button" onClick={cancelCaptureMode}>
                  Cancel
                </button>
              )}
            </div>

            {isCapturing && (
              <p className="muted">
                Drag over the video and release. The selected region is saved automatically.
              </p>
            )}
          </div>
        )}

        <div className="video-grid">{renderVideo()}</div>

        {role === "professor" && peerConnections.length > 0 && (
          <div className="participant-streams">
            <h3>Student camera feeds</h3>
            <div className="participant-stream-grid">
              {peerConnections.map((peer) => (
                <RemoteVideoTile
                  key={peer.socketId}
                  stream={remoteStreams[peer.socketId]}
                  connection={peer.connection}
                  name={peer.displayName}
                  selected={activePeerId === peer.socketId}
                  onClick={() => selectPeer(peer.socketId)}
                />
              ))}
            </div>
          </div>
        )}

        {role === "professor" && activeSession && remoteStream && (
          <AIAnalysisPanel
            videoRef={videoRef}
            serverUrl={SERVER_URL}
            token={authState.token}
            sessionCode={activeSession}
            participantId={peerConnections.find((peer) => peer.socketId === activePeerId)?.participantId}
            onDetections={handleAIDetections}
            onSelectRoi={captureSuggestedRoi}
          />
        )}

        {role === "student" && (
          <p className="muted">
            The professor's annotations will appear over your camera view.
          </p>
        )}
      </section>

      <MecMonitor serverUrl={SERVER_URL} token={authState.token} />
      {role === 'professor' && <BenchmarkPanel serverUrl={SERVER_URL} token={authState.token} sessionCode={activeSession} />}
      {activeSession && <NetworkDashboard peerConnections={peerConnections} socket={socket} role={role} currentUserId={authState.user.id} />}

      {/* Shared workspace is visible to both professor and student. */}
      {activeSession && (
        <section className="panel workspace-panel" id="workspace">
          <h2>Shared snapshots workspace</h2>
          <p className="muted">
            Snapshots captured by the professor are shared with participants
            in this session.
          </p>

          <MultiRoiWorkspace
            key={activeSession}
            ref={workspaceRef}
            initialRois={getSnapshotsInCaptureOrder(snapshots).map((snapshot, index) =>
              toWorkspaceRoi(snapshot, index, snapshotHistory)
            )}
            onUploadImage={uploadWorkspaceImage}
            canUpload={role === "professor"}
            onRemoveRoi={removeWorkspaceRoi}
            onRestoreSnapshot={restoreWorkspaceSnapshot}
            onUpdateSnapshot={updateWorkspaceSnapshot}
            canAnnotate={role === "professor"}
            style={{ height: "720px", width: "100%" }}
          />
        </section>
      )}

      <footer>5G Live Lab Assist · Local development prototype</footer>
    </main>
  );
}
