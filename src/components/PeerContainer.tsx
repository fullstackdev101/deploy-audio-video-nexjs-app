"use client";

import { useEffect, useCallback, useRef } from "react";
import {
  usePeerStore,
  ChatMessage,
  type ConnectionStatus,
} from "@/store/usePeerStore";
import { useGroupStore } from "@/store/useGroupStore";
import type Peer from "peerjs";
import type { DataConnection } from "peerjs";

// ─── Human-readable DOMException → message mapping ───────────────────────────
function mediaErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return "Could not access camera/microphone.";
  switch (err.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Camera/mic permission denied. Allow access in your browser's address bar and try again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera or microphone found. Please connect a device and try again.";
    case "NotReadableError":
    case "TrackStartError":
      return "Camera/microphone is already in use by another application. Close it and try again.";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "Your camera/mic doesn't support the requested settings. Try a different device.";
    case "TypeError":
      return "No camera or microphone detected. Please connect a device.";
    default:
      return `Media error (${err.name}): ${err.message}`;
  }
}

// ─── Get best available stream: video+audio → video-only → audio-only → throw
async function getBestStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });
  } catch (err) {
    const name = (err as Error).name;
    if (name === "NotAllowedError" || name === "PermissionDeniedError") throw err;
    console.warn("[PeerLink] Combined video+audio failed. Attempting fallbacks:", err);
    try {
      console.log("[PeerLink] Attempting video-only fallback...");
      return await navigator.mediaDevices.getUserMedia({ video: true });
    } catch {
      console.warn("[PeerLink] Video-only failed. Attempting audio-only...");
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        console.log("[PeerLink] Audio-only fallback successful.");
        return s;
      } catch {
        console.error("[PeerLink] All media access attempts failed.");
        throw err;
      }
    }
  }
}

// ─── How long each side waits for the remote stream before giving up (ms) ─────
const CALL_TIMEOUT_MS = 60_000;

// ─── ICE / TURN configuration ─────────────────────────────────────────────────
//
// Key insight for restrictive ISPs (PTCL, corporate WiFi, symmetric NAT):
//   • STUN alone fails on symmetric NAT — the mapped port differs per destination
//   • TURN relay is the only guaranteed path through firewalls
//   • Ports 80/443 are almost never blocked; 3478 often is
//   • metered.ca private credentials → global.relay.metered.ca  (NOT openrelay.metered.ca)
//   • openrelay.metered.ca          → anonymous public credentials only
//
const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

const TURN_HOST_RAW = process.env.NEXT_PUBLIC_TURN_HOST ?? "";
const TURN_USER     = process.env.NEXT_PUBLIC_TURN_USER ?? "";
const TURN_PASS     = process.env.NEXT_PUBLIC_TURN_PASS ?? "";

// Strip any scheme/port the user may have accidentally included in the env var
function stripSchemeAndPort(host: string): string {
  return host
    .replace(/^(turns?:)(\/\/)?/, "")
    .replace(/:\d+.*$/, "")
    .trim();
}

const TURN_HOST = stripSchemeAndPort(TURN_HOST_RAW);

// Determine if private credentials are properly configured
const hasPrivateTurn = !!(TURN_HOST && TURN_USER && TURN_PASS);

// ── Private metered.ca TURN (when credentials are configured) ────────────────
// global.relay.metered.ca is the correct host for private/paid credentials.
// Ports 80/443 bypass most ISP and firewall restrictions.
const privateTurnServers: RTCIceServer[] = hasPrivateTurn
  ? [
      {
        urls: [
          "turn:global.relay.metered.ca:80",
          "turn:global.relay.metered.ca:80?transport=tcp",
          "turns:global.relay.metered.ca:443?transport=tcp",
        ],
        username: TURN_USER,
        credential: TURN_PASS,
      },
    ]
  : [];

// ── Public openrelay — ALWAYS included as safety net ─────────────────────────
// Even when private creds are set we keep this. If private creds are expired
// or the metered.ca server is unreachable, the public relay still provides a
// working path. ICE will use whichever relay candidate succeeds first.
const publicTurnServers: RTCIceServer[] = [
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:80?transport=tcp",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

// Belt-and-suspenders: STUN + private TURN (if set) + public TURN always
const ICE_SERVERS: RTCIceServer[] = [
  ...STUN_SERVERS,
  ...privateTurnServers,
  ...publicTurnServers,
];

// ── Startup diagnostics ───────────────────────────────────────────────────────
if (hasPrivateTurn) {
  console.log(
    `%c[PeerLink] ✅ TURN: private credentials active — global.relay.metered.ca (user: ${TURN_USER.slice(0, 8)}…) + public openrelay fallback`,
    "color:#22c55e;font-weight:bold",
  );
} else {
  console.warn(
    "%c[PeerLink] ⚠️ TURN: no private credentials — public openrelay only (rate-limited). " +
      "Set NEXT_PUBLIC_TURN_HOST / USER / PASS in .env.local for reliable connections on PTCL/WiFi.",
    "color:#f59e0b;font-weight:bold",
  );
}
console.log(
  "[PeerLink] ICE servers:",
  ICE_SERVERS.map((s) => ({ urls: s.urls, user: s.username ? String(s.username).slice(0, 8) + "…" : undefined })),
);

// ─── TURN connectivity probe ──────────────────────────────────────────────────
// Runs once on page load. Creates a throwaway RTCPeerConnection, gathers ICE
// candidates, and reports whether relay (TURN) candidates were found.
// This tells you immediately if your TURN credentials are valid and reachable.
async function probeTurnConnectivity(): Promise<void> {
  if (typeof RTCPeerConnection === "undefined") return;
  console.log("[PeerLink] 🔍 Probing TURN reachability...");
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.createDataChannel("__probe__");

  await new Promise<void>((resolve) => {
    const found = { relay: false, srflx: false };
    const finish = () => { try { pc.close(); } catch { /* ignore */ } resolve(); };
    const timer = setTimeout(finish, 8000);

    pc.onicecandidate = (e) => {
      if (!e.candidate) { clearTimeout(timer); finish(); return; }
      const t = e.candidate.type as string;
      if (t === "relay" && !found.relay) {
        found.relay = true;
        console.log(
          "%c[PeerLink] ✅ TURN relay candidate gathered — calls will work on all networks.",
          "color:#22c55e;font-weight:bold",
          e.candidate.candidate,
        );
      }
      if (t === "srflx" && !found.srflx) {
        found.srflx = true;
        console.log("[PeerLink] ✅ STUN srflx candidate gathered:", e.candidate.candidate);
      }
    };

    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timer);
        if (!found.relay) {
          console.warn(
            "%c[PeerLink] ⚠️ No TURN relay candidates gathered after ICE complete. " +
              "TURN auth may have failed — verify credentials at https://dashboard.metered.ca",
            "color:#f59e0b;font-weight:bold",
          );
        }
        finish();
      }
    };

    pc.createOffer()
      .then((o) => pc.setLocalDescription(o))
      .catch(() => { clearTimeout(timer); finish(); });
  });
}

if (typeof window !== "undefined") {
  probeTurnConnectivity().catch(() => {
    console.warn("[PeerLink] TURN probe threw — check browser console for details.");
  });
}

// ─── PeerJS RTCConfiguration ──────────────────────────────────────────────────
const PEER_CONFIG: RTCConfiguration = {
  iceServers: ICE_SERVERS,
  iceTransportPolicy: "all",   // try direct first, relay as fallback
  iceCandidatePoolSize: 10,    // pre-gather relay candidates before call starts
};

// ─── PeerContainer ────────────────────────────────────────────────────────────
export default function PeerContainer({ children }: { children: React.ReactNode }) {
  const {
    setPeer, setMyId,
    setDataConnection, setMediaCall, setIncomingCall,
    setStatus, setRemotePeerId,
    addMessage, setError,
  } = usePeerStore();

  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let peerInstance: Peer;

    const init = async () => {
      setStatus("initializing");
      const { default: PeerJS } = await import("peerjs");

      console.log("[PeerLink] Initializing PeerJS — iceTransportPolicy: all, iceCandidatePoolSize: 10");
      peerInstance = new PeerJS(undefined as unknown as string, {
        debug: 2,
        config: PEER_CONFIG,
      });
      peerRef.current = peerInstance;
      setPeer(peerInstance);

      peerInstance.on("open", (id) => {
        console.log("[PeerLink] Peer open, my ID:", id);
        setMyId(id);
        setStatus("ready");
      });

      // Incoming data connection (receiver side — caller opens this after media connects)
      peerInstance.on("connection", (conn) => {
        // Skip if group mode is active — GroupPeerContainer handles it
        if (useGroupStore.getState().groupStatus === "in-room") return;
        console.log("[PeerLink] Incoming data connection from:", conn.peer);
        const existing = usePeerStore.getState().dataConnection;
        if (existing && existing !== conn) existing.close();
        setupDataConnection(conn, addMessage, setDataConnection, setStatus);
      });

      // Incoming media call — park for user to accept/decline
      peerInstance.on("call", (call) => {
        // Skip if group mode is active — GroupPeerContainer handles it
        if (useGroupStore.getState().groupStatus === "in-room") return;
        const currentStatus = usePeerStore.getState().status;
        if (currentStatus === "connected" || currentStatus === "calling" || currentStatus === "incoming") {
          call.close();
          return;
        }
        console.log("[PeerLink] Incoming call from:", call.peer);
        setIncomingCall(call);
        setRemotePeerId(call.peer);
        setStatus("incoming");

        call.on("close", () => {
          if (usePeerStore.getState().status === "incoming") {
            setIncomingCall(null);
            setRemotePeerId("");
            setStatus("ready");
          }
        });
        call.on("error", () => {
          if (usePeerStore.getState().status === "incoming") {
            setIncomingCall(null);
            setRemotePeerId("");
            setStatus("ready");
          }
        });
      });

      peerInstance.on("error", (err) => {
        console.error("[PeerLink] Peer error:", err.type, err.message);
        setError(err.message);
      });
    };

    init();

    return () => {
      if (peerRef.current && !peerRef.current.destroyed) peerRef.current.destroy();
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}

// ─── Data connection setup ────────────────────────────────────────────────────
// Used by both caller and receiver. Handles open/data/close/error uniformly.
function setupDataConnection(
  conn: DataConnection,
  addMessage: (msg: ChatMessage) => void,
  setDataConnection: (conn: DataConnection | null) => void,
  setStatus: (status: ConnectionStatus) => void,
): void {
  console.log("[PeerLink] Setting up data connection with:", conn.peer);

  conn.on("data", (raw: unknown) => {
    try {
      const parsed = JSON.parse(raw as string) as { text: string };
      addMessage({ id: crypto.randomUUID(), from: "them", text: parsed.text, timestamp: new Date() });
    } catch { /* ignore malformed */ }
  });

  conn.on("close", () => {
    console.log("[PeerLink] Data connection closed");
    setDataConnection(null);
    const s = usePeerStore.getState().status;
    if (s !== "connected" && s !== "calling") setStatus("ready");
  });

  conn.on("error", (err) => {
    console.warn("[PeerLink] Data connection error:", err);
    setDataConnection(null);
  });

  if (conn.open) {
    console.log("[PeerLink] ✅ Data connection already open");
    setDataConnection(conn);
  } else {
    console.log("[PeerLink] Waiting for data connection to open...");
    conn.on("open", () => {
      console.log("[PeerLink] ✅ Data connection opened successfully");
      setDataConnection(conn);
    });
  }
}

// ─── Attempt to open a data channel with retries ─────────────────────────────
// On restrictive networks the first connect() attempt can fail silently.
// We retry up to MAX_DC_RETRIES times with a short delay between attempts.
const MAX_DC_RETRIES = 3;
const DC_RETRY_DELAY_MS = 2000;

function openDataChannelWithRetry(
  peer: Peer,
  remotePeerId: string,
  addMessage: (msg: ChatMessage) => void,
  setDataConnection: (conn: DataConnection | null) => void,
  setStatus: (status: ConnectionStatus) => void,
  attempt = 1,
): void {
  console.log(`[PeerLink] Opening data channel to ${remotePeerId} (attempt ${attempt}/${MAX_DC_RETRIES})`);
  const conn = peer.connect(remotePeerId, { reliable: true, serialization: "json" });

  // Track whether this attempt succeeded
  let succeeded = false;

  const openHandler = () => {
    succeeded = true;
    console.log(`[PeerLink] ✅ Data channel open on attempt ${attempt}`);
    setupDataConnection(conn, addMessage, setDataConnection, setStatus);
  };

  const errorHandler = (err: Error) => {
    console.warn(`[PeerLink] Data channel attempt ${attempt} error:`, err);
    if (!succeeded && attempt < MAX_DC_RETRIES) {
      setTimeout(() => {
        openDataChannelWithRetry(peer, remotePeerId, addMessage, setDataConnection, setStatus, attempt + 1);
      }, DC_RETRY_DELAY_MS);
    } else if (!succeeded) {
      console.error("[PeerLink] Data channel failed after all retries. Chat will be unavailable.");
    }
  };

  // Set a timeout — if the connection doesn't open within 8s, retry
  const timeoutId = setTimeout(() => {
    if (!succeeded) {
      console.warn(`[PeerLink] Data channel attempt ${attempt} timed out`);
      conn.close();
      if (attempt < MAX_DC_RETRIES) {
        openDataChannelWithRetry(peer, remotePeerId, addMessage, setDataConnection, setStatus, attempt + 1);
      } else {
        console.error("[PeerLink] Data channel failed after all retries. Chat will be unavailable.");
      }
    }
  }, 8000);

  conn.on("open", () => {
    clearTimeout(timeoutId);
    openHandler();
  });
  conn.on("error", (err) => {
    clearTimeout(timeoutId);
    errorHandler(err);
  });
}

// ─── Call actions hook ────────────────────────────────────────────────────────
export function useCallActions() {
  const store = usePeerStore();

  // ── OUTGOING CALL ──────────────────────────────────────────────────────────
  const startCall = useCallback(async () => {
    const { peer, remotePeerId, setError } = store;
    if (!peer || !remotePeerId) return;

    console.log("[PeerLink] Starting call to:", remotePeerId);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Media devices not available. Use HTTPS or localhost.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await getBestStream();
    } catch (err) {
      console.error("[PeerLink] getUserMedia error:", err);
      store.setError(mediaErrorMessage(err));
      return;
    }

    console.log("[PeerLink] Local stream — video:", stream.getVideoTracks().length, "audio:", stream.getAudioTracks().length);
    store.setLocalStream(stream);
    store.setHasLocalVideo(stream.getVideoTracks().length > 0);
    store.setStatus("calling");

    const call = peer.call(remotePeerId, stream);
    store.setMediaCall(call);

    const timeoutId = setTimeout(() => {
      if (usePeerStore.getState().status === "calling") {
        console.warn("[PeerLink] Caller timed out");
        call.close();
        stream.getTracks().forEach((t) => t.stop());
        store.setLocalStream(null);
        store.setMediaCall(null);
        store.setStatus("ready");
        store.setError("No answer. The other peer did not accept the call in time.");
      }
    }, CALL_TIMEOUT_MS);

    call.on("stream", (remoteStream) => {
      clearTimeout(timeoutId);
      console.log("[PeerLink] ✅ Caller got remote stream — video tracks:", remoteStream.getVideoTracks().length);
      store.setRemoteStream(remoteStream);
      store.setHasRemoteVideo(remoteStream.getVideoTracks().length > 0);
      store.setStatus("connected");

      // Open data channel now that media is flowing.
      // Use retry logic — on restrictive networks the first attempt may fail.
      openDataChannelWithRetry(peer, remotePeerId, store.addMessage, store.setDataConnection, store.setStatus);
    });

    call.on("close", () => {
      clearTimeout(timeoutId);
      console.log("[PeerLink] Caller: call closed");
      stream.getTracks().forEach((t) => t.stop());
      store.setLocalStream(null);
      store.setRemoteStream(null);
      store.setMediaCall(null);
      store.setStatus("ready");
    });

    call.on("error", (err) => {
      clearTimeout(timeoutId);
      console.error("[PeerLink] Caller call error:", err);
      stream.getTracks().forEach((t) => t.stop());
      store.setLocalStream(null);
      store.setRemoteStream(null);
      store.setMediaCall(null);
      store.setStatus("ready");
      store.setError("Call connection error. Please try again.");
    });
  }, [store]);

  // ── ACCEPT INCOMING CALL ───────────────────────────────────────────────────
  const acceptCall = useCallback(async () => {
    const { incomingCall, setError } = store;
    if (!incomingCall) return;

    console.log("[PeerLink] Accepting call from:", incomingCall.peer);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Media devices not available. Use HTTPS or localhost.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await getBestStream();
    } catch (err) {
      console.error("[PeerLink] acceptCall getUserMedia error:", err);
      store.setError(mediaErrorMessage(err));
      incomingCall.close();
      store.setIncomingCall(null);
      store.setStatus("ready");
      return;
    }

    console.log("[PeerLink] Local stream — video:", stream.getVideoTracks().length, "audio:", stream.getAudioTracks().length);
    store.setLocalStream(stream);
    store.setHasLocalVideo(stream.getVideoTracks().length > 0);

    const answererTimeout = setTimeout(() => {
      if (usePeerStore.getState().status === "calling") {
        console.warn("[PeerLink] Receiver timed out waiting for remote stream");
        incomingCall.close();
        stream.getTracks().forEach((t) => t.stop());
        store.setLocalStream(null);
        store.setMediaCall(null);
        store.setStatus("ready");
        store.setError("Connection timed out. The caller's network may be blocking direct connections.");
      }
    }, CALL_TIMEOUT_MS);

    incomingCall.on("stream", (remoteStream) => {
      clearTimeout(answererTimeout);
      console.log("[PeerLink] ✅ Receiver got remote stream — video tracks:", remoteStream.getVideoTracks().length);
      store.setRemoteStream(remoteStream);
      store.setHasRemoteVideo(remoteStream.getVideoTracks().length > 0);
      store.setStatus("connected");

      // Receiver also attempts to open a data channel as a fallback.
      // If the caller already opened one, the peer "connection" event fires first
      // and setDataConnection is already set — the retry here will be a no-op
      // because the receiver side's peer.on("connection") handler runs first.
      // But if the caller's data channel failed, this ensures chat still works.
      const { peer, remotePeerId } = usePeerStore.getState();
      if (peer && remotePeerId && !usePeerStore.getState().dataConnection) {
        console.log("[PeerLink] Receiver: no data channel yet, opening one...");
        openDataChannelWithRetry(peer, remotePeerId, store.addMessage, store.setDataConnection, store.setStatus);
      }
    });

    incomingCall.on("close", () => {
      clearTimeout(answererTimeout);
      console.log("[PeerLink] Receiver: call closed");
      stream.getTracks().forEach((t) => t.stop());
      store.setLocalStream(null);
      store.setRemoteStream(null);
      store.setMediaCall(null);
      store.setStatus("ready");
    });

    incomingCall.on("error", (err) => {
      clearTimeout(answererTimeout);
      console.error("[PeerLink] acceptCall error:", err);
      stream.getTracks().forEach((t) => t.stop());
      store.setLocalStream(null);
      store.setRemoteStream(null);
      store.setMediaCall(null);
      store.setStatus("ready");
    });

    console.log("[PeerLink] Answering call...");
    try {
      incomingCall.answer(stream);
      store.setMediaCall(incomingCall);
      store.setIncomingCall(null);
      store.setStatus("calling");
      console.log("[PeerLink] Call answered successfully");
    } catch (err) {
      console.error("[PeerLink] Error answering call:", err);
      stream.getTracks().forEach((t) => t.stop());
      store.setLocalStream(null);
      store.setMediaCall(null);
      store.setStatus("ready");
      store.setError("Failed to answer call. Check browser console and ensure connection is stable.");
    }
  }, [store]);

  // ── DECLINE INCOMING CALL ──────────────────────────────────────────────────
  const declineCall = useCallback(() => {
    const { incomingCall } = store;
    if (incomingCall) {
      incomingCall.close();
      store.setIncomingCall(null);
    }
    store.setStatus("ready");
  }, [store]);

  // ── TEXT-ONLY CHAT ─────────────────────────────────────────────────────────
  const startTextChat = useCallback(() => {
    const { peer, remotePeerId } = store;
    if (!peer || !remotePeerId) return;
    console.log("[PeerLink] Starting text chat with:", remotePeerId);
    openDataChannelWithRetry(peer, remotePeerId, store.addMessage, store.setDataConnection, store.setStatus);
    store.setStatus("connected");
    if (!store.isChatOpen) store.toggleChat();
  }, [store]);

  // ── END CALL ───────────────────────────────────────────────────────────────
  const endCall = useCallback(() => {
    const { mediaCall, dataConnection, localStream, incomingCall } = store;
    mediaCall?.close();
    dataConnection?.close();
    incomingCall?.close();
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      store.setLocalStream(null);
    }
    store.setStatus("ready");
    store.setRemoteStream(null);
    store.setMediaCall(null);
    store.setDataConnection(null);
    store.setIncomingCall(null);
    store.setHasRemoteVideo(false);
    store.setHasLocalVideo(false);
  }, [store]);

  // ── SEND MESSAGE ───────────────────────────────────────────────────────────
  const sendMessage = useCallback((text: string) => {
    const { dataConnection } = store;
    if (!dataConnection || !text.trim()) return;
    dataConnection.send(JSON.stringify({ text: text.trim() }));
    store.addMessage({ id: crypto.randomUUID(), from: "me", text: text.trim(), timestamp: new Date() });
  }, [store]);

  return { startCall, acceptCall, declineCall, startTextChat, endCall, sendMessage };
}
