"use client";

import { useEffect, useCallback, useRef } from "react";
import {
  usePeerStore,
  ChatMessage,
  type ConnectionStatus,
} from "@/store/usePeerStore";
import type Peer from "peerjs";
import type { DataConnection, MediaConnection } from "peerjs";

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
    // 1. Attempt both video and audio with broad compatibility
    return await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });
  } catch (err) {
    const name = (err as Error).name;
    // If the user explicitly denied permission, don't attempt fallbacks
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      throw err;
    }

    console.warn(
      "[PeerLink] Combined video+audio failed. Attempting fallbacks:",
      err,
    );

    // 2. Fallback to video-only with minimal constraints for broad camera support
    try {
      console.log("[PeerLink] Attempting video-only fallback...");
      return await navigator.mediaDevices.getUserMedia({
        video: true, // Minimal constraints for broader camera compatibility
      });
    } catch (videoErr) {
      console.warn(
        "[PeerLink] Video-only fallback failed. Attempting audio-only:",
        videoErr,
      );

      // 3. Fallback to audio-only (e.g., microphone exists, but NO camera)
      try {
        console.log("[PeerLink] Attempting audio-only fallback...");
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        console.log("[PeerLink] Audio-only fallback successful.");
        return audioStream;
      } catch (audioErr) {
        // If everything fails, throw the original error to display in the UI
        console.error("[PeerLink] All media access attempts failed:", err);
        throw err;
      }
    }
  }
}

// ─── How long each side waits for the remote stream before giving up (ms) ─────
const CALL_TIMEOUT_MS = 60_000;

// ─── ICE servers ──────────────────────────────────────────────────────────────
// We include several public STUN servers plus a TURN relay.
// TURN is essential for peers behind symmetric NAT / corporate firewalls —
// without it, WebRTC can stall or never finish connecting.
const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
];

const TURN_SERVER_HOST = process.env.NEXT_PUBLIC_TURN_HOST;
const TURN_SERVER_USER = process.env.NEXT_PUBLIC_TURN_USER;
const TURN_SERVER_PASS = process.env.NEXT_PUBLIC_TURN_PASS;

function normalizeTurnHost(host: string): string {
  // Strip scheme (turn:, turns:, //) and any existing port
  return host
    .replace(/^(turn:|turns:)(\/\/)?/, "") // Remove scheme
    .replace(/:\d+(\?|$)/, "$1"); // Remove port if present
}

const configuredTurnServers: RTCIceServer[] =
  TURN_SERVER_HOST && TURN_SERVER_USER && TURN_SERVER_PASS
    ? [
        {
          urls: [
            `turn:${normalizeTurnHost(TURN_SERVER_HOST)}:3478?transport=udp`,
            `turn:${normalizeTurnHost(TURN_SERVER_HOST)}:3478?transport=tcp`,
            `turns:${normalizeTurnHost(TURN_SERVER_HOST)}:5349?transport=tcp`,
          ],
          username: TURN_SERVER_USER,
          credential: TURN_SERVER_PASS,
        },
      ]
    : [];

if (!configuredTurnServers.length) {
  console.warn(
    "[PeerLink] TURN env not configured. Falling back to openrelay public TURN relay. This may fail on restrictive networks.",
  );
}

const ICE_SERVERS: RTCIceServer[] = [
  ...STUN_SERVERS,
  ...(configuredTurnServers.length > 0
    ? configuredTurnServers
    : [
        {
          urls: [
            "turn:openrelay.metered.ca:80",
            "turn:openrelay.metered.ca:443",
            "turn:openrelay.metered.ca:443?transport=tcp",
          ],
          username: "openrelayproject",
          credential: "openrelayproject",
        },
      ]),
];

export default function PeerContainer({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    setPeer,
    setMyId,
    setLocalStream,
    setRemoteStream,
    setDataConnection,
    setMediaCall,
    setIncomingCall,
    setStatus,
    setRemotePeerId,
    setHasRemoteVideo,
    setHasLocalVideo,
    addMessage,
    setError,
  } = usePeerStore();

  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // ── PEER INITIALISATION ────────────────────────────────────────────────────
  useEffect(() => {
    let peerInstance: Peer;

    const init = async () => {
      setStatus("initializing");
      const { default: PeerJS } = await import("peerjs");

      peerInstance = new PeerJS(undefined as unknown as string, {
        debug: 1,
        config: { iceServers: ICE_SERVERS, iceTransportPolicy: "all" },
      });
      peerRef.current = peerInstance;
      setPeer(peerInstance);

      peerInstance.on("open", (id) => {
        setMyId(id);
        setStatus("ready");
      });

      // ── Incoming data connection (from the caller) ──
      // Always accept the inbound connection. If there was a stale one, close
      // it first so we don't end up with two competing channels.
      peerInstance.on("connection", (conn) => {
        const existing = usePeerStore.getState().dataConnection;
        if (existing && existing !== conn) {
          existing.close();
        }
        // Use the standardized setup for consistency with caller side
        setupDataConnection(conn, addMessage, setDataConnection, setStatus);
      });

      // ── Incoming media call: DON'T auto-answer — park it for the user ──
      peerInstance.on("call", (call) => {
        // Reject if already in a call
        const currentStatus = usePeerStore.getState().status;
        if (
          currentStatus === "connected" ||
          currentStatus === "calling" ||
          currentStatus === "incoming"
        ) {
          call.close();
          return;
        }
        setIncomingCall(call);
        setRemotePeerId(call.peer);
        setStatus("incoming");

        // If the caller hangs up before we answer, clean up automatically
        call.on("close", () => {
          const s = usePeerStore.getState().status;
          if (s === "incoming") {
            setIncomingCall(null);
            setRemotePeerId("");
            setStatus("ready");
          }
        });
        call.on("error", () => {
          const s = usePeerStore.getState().status;
          if (s === "incoming") {
            setIncomingCall(null);
            setRemotePeerId("");
            setStatus("ready");
          }
        });
      });

      peerInstance.on("error", (err) => {
        console.error("[PeerLink] peer error:", err);
        setError(err.message);
      });
    };

    init();

    return () => {
      if (peerRef.current && !peerRef.current.destroyed) {
        peerRef.current.destroy();
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}

// ─── Standard data connection setup (used by both caller and receiver) ────────
function setupDataConnection(
  conn: DataConnection,
  addMessage: (msg: ChatMessage) => void,
  setDataConnection: (conn: DataConnection | null) => void,
  setStatus: (status: ConnectionStatus) => void,
): void {
  console.log("[PeerLink] Setting up data connection with peer:::", conn.peer);

  const onData = (raw: unknown) => {
    try {
      const parsed = JSON.parse(raw as string) as { text: string };
      const msg: ChatMessage = {
        id: crypto.randomUUID(),
        from: "them",
        text: parsed.text,
        timestamp: new Date(),
      };
      addMessage(msg);
    } catch {
      /* ignore malformed */
    }
  };
  const onClose = () => {
    console.log("[PeerLink] Data connection closed");
    setDataConnection(null);
    // Only drop back to ready if we are not mid-call
    const s = usePeerStore.getState().status;
    if (s !== "connected" && s !== "calling") {
      setStatus("ready");
    }
  };

  conn.on("data", onData);
  conn.on("close", onClose);
  conn.on("error", (err) => {
    console.warn("[PeerLink] Data connection error:", err);
    setDataConnection(null);
  });

  // Only mark connection as ready once it's actually open.
  // Handle both cases: already open or will open soon.
  if (conn.open) {
    console.log("[PeerLink] Data connection already open");
    setDataConnection(conn);
  } else {
    console.log("[PeerLink] Waiting for data connection to open...");
    conn.on("open", () => {
      console.log("[PeerLink] Data connection opened successfully");
      setDataConnection(conn);
    });
  }
}

// ─── Exported call-action hooks ────────────────────────────────────────────────

export function useCallActions() {
  const store = usePeerStore();

  // ── OUTGOING CALL ────────────────────────────────────────────────────────────
  const startCall = useCallback(async () => {
    const { peer, remotePeerId, setError } = store;
    if (!peer || !remotePeerId) return;

    console.log("[PeerLink] Starting call to:", remotePeerId);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Media devices are not available. Make sure you are using HTTPS or localhost.",
      );
      return;
    }

    let stream: MediaStream;
    try {
      stream = await getBestStream();
    } catch (err) {
      console.error("[PeerLink] startCall getUserMedia error:", err);
      store.setError(mediaErrorMessage(err));
      return;
    }

    console.log(
      "[PeerLink] Got local stream. Video tracks:",
      stream.getVideoTracks().length,
      "Audio tracks:",
      stream.getAudioTracks().length,
    );

    store.setLocalStream(stream);
    store.setHasLocalVideo(stream.getVideoTracks().length > 0);
    store.setStatus("calling");

    // ── Media call ─────────────────────────────────────────────────────────
    console.log("[PeerLink] Making media call to:", remotePeerId);
    const call = peer.call(remotePeerId, stream);
    store.setMediaCall(call);

    // ── Timeout: give up if receiver doesn't answer ─────────────────────────
    const timeoutId = setTimeout(() => {
      const s = usePeerStore.getState().status;
      if (s === "calling") {
        console.warn("[PeerLink] Caller timed out waiting for answer");
        call.close();
        stream.getTracks().forEach((t) => t.stop());
        store.setLocalStream(null);
        store.setMediaCall(null);
        store.setStatus("ready");
        store.setError(
          "No answer. The other peer did not accept the call in time.",
        );
      }
    }, CALL_TIMEOUT_MS);

    call.on("stream", (remoteStream) => {
      clearTimeout(timeoutId);
      console.log(
        "[PeerLink] Caller got remote stream. Video tracks:",
        remoteStream.getVideoTracks().length,
      );
      store.setRemoteStream(remoteStream);
      store.setHasRemoteVideo(remoteStream.getVideoTracks().length > 0);
      store.setStatus("connected");

      // ── Open data channel after media connection is established ───────────────────────────
      // The caller opens ONE outbound DataConnection after media is connected.
      // The receiver will get it via the peer "connection" event.
      console.log("[PeerLink] Caller: creating data connection...");
      const conn = peer.connect(remotePeerId, { reliable: true });
      setupDataConnection(
        conn,
        store.addMessage,
        store.setDataConnection,
        store.setStatus,
      );
    });

    // ── Handle call close on caller side (when receiver hangs up) ──────────────────────────
    call.on("close", () => {
      clearTimeout(timeoutId);
      console.log("[PeerLink] Caller: call closed by remote peer");
      stream.getTracks().forEach((t) => t.stop());
      store.setLocalStream(null);
      store.setRemoteStream(null);
      store.setMediaCall(null);
      store.setStatus("ready");
    });

    // ── Handle call errors on caller side ─────────────────────────────────────────────────
    call.on("error", (err) => {
      clearTimeout(timeoutId);
      console.error("[PeerLink] Caller-side call error:", err);
      stream.getTracks().forEach((t) => t.stop());
      store.setLocalStream(null);
      store.setRemoteStream(null);
      store.setMediaCall(null);
      store.setStatus("ready");
      store.setError("Call connection error. Please try again.");
    });
  }, [store]);

  // ── ACCEPT INCOMING CALL ────────────────────────────────────────────────────
  const acceptCall = useCallback(async () => {
    const { incomingCall, peer, remotePeerId, setError } = store;
    if (!incomingCall) return;

    console.log("[PeerLink] Accepting incoming call from:", incomingCall.peer);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Media devices are not available. Make sure you are using HTTPS or localhost.",
      );
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

    console.log(
      "[PeerLink] Got local stream. Video tracks:",
      stream.getVideoTracks().length,
      "Audio tracks:",
      stream.getAudioTracks().length,
    );

    store.setLocalStream(stream);
    store.setHasLocalVideo(stream.getVideoTracks().length > 0);

    // Attach event handlers before answering, to avoid missing early events.
    const answererTimeout = setTimeout(() => {
      const s = usePeerStore.getState().status;
      if (s === "calling") {
        console.warn("[PeerLink] Receiver timed out waiting for remote stream");
        incomingCall.close();
        stream.getTracks().forEach((t) => t.stop());
        store.setLocalStream(null);
        store.setMediaCall(null);
        store.setStatus("ready");
        store.setError(
          "Connection timed out. The caller's network may be blocking direct connections.",
        );
      }
    }, CALL_TIMEOUT_MS);

    incomingCall.on("stream", (remoteStream) => {
      clearTimeout(answererTimeout);
      console.log(
        "[PeerLink] Receiver got remote stream. Video tracks:",
        remoteStream.getVideoTracks().length,
      );
      store.setRemoteStream(remoteStream);
      store.setHasRemoteVideo(remoteStream.getVideoTracks().length > 0);
      store.setStatus("connected");
    });
    incomingCall.on("close", () => {
      clearTimeout(answererTimeout);
      console.log("[PeerLink] Receiver: incoming call closed");
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
      store.setStatus("calling"); // Receiver is now in calling state while connecting
      console.log("[PeerLink] Call answered successfully");
    } catch (err) {
      console.error("[PeerLink] Error answering call:", err);
      stream.getTracks().forEach((t) => t.stop());
      store.setLocalStream(null);
      store.setMediaCall(null);
      store.setStatus("ready");
      store.setError(
        "Failed to answer call. Check browser console and ensure connection is stable.",
      );
    }

    // Data connection will be established by the caller and received via peer "connection" event
  }, [store]);

  // ── DECLINE INCOMING CALL ───────────────────────────────────────────────────
  const declineCall = useCallback(() => {
    const { incomingCall } = store;
    if (incomingCall) {
      incomingCall.close();
      store.setIncomingCall(null);
    }
    store.setStatus("ready");
  }, [store]);

  // ── TEXT-ONLY CHAT ──────────────────────────────────────────────────────────
  const startTextChat = useCallback(() => {
    const { peer, remotePeerId } = store;
    if (!peer || !remotePeerId) return;

    console.log("[PeerLink] Starting text-only chat with:", remotePeerId);
    const conn = peer.connect(remotePeerId, { reliable: true });
    setupDataConnection(
      conn,
      store.addMessage,
      store.setDataConnection,
      store.setStatus,
    );
    store.setStatus("connected");
    if (!store.isChatOpen) store.toggleChat();
  }, [store]);

  // ── END CALL / DISCONNECT ───────────────────────────────────────────────────
  const endCall = useCallback(() => {
    const { mediaCall, dataConnection, localStream, incomingCall } = store;

    // Close connections (this triggers close events on both sides via PeerJS signaling)
    mediaCall?.close();
    dataConnection?.close();
    incomingCall?.close();

    // Stop local tracks
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      store.setLocalStream(null);
    }

    // Reset will be called by the close event handlers on both sides.
    // We clear immediate state to prevent race conditions.
    store.setStatus("ready");
    store.setRemoteStream(null);
    store.setMediaCall(null);
    store.setDataConnection(null);
    store.setIncomingCall(null);
    store.setHasRemoteVideo(false);
    store.setHasLocalVideo(false);
  }, [store]);

  // ── SEND MESSAGE ────────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    (text: string) => {
      const { dataConnection } = store;
      if (!dataConnection || !text.trim()) return;
      dataConnection.send(JSON.stringify({ text: text.trim() }));
      store.addMessage({
        id: crypto.randomUUID(),
        from: "me",
        text: text.trim(),
        timestamp: new Date(),
      });
    },
    [store],
  );

  return {
    startCall,
    acceptCall,
    declineCall,
    startTextChat,
    endCall,
    sendMessage,
  };
}
