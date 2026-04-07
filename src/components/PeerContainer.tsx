"use client";

import { useEffect, useCallback, useRef } from "react";
import { usePeerStore, ChatMessage } from "@/store/usePeerStore";
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
    // 1. Attempt both video and audio together
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

    console.warn("Combined video+audio failed. Attempting fallbacks:", err);

    // 2. Fallback to video-only (e.g., camera exists, but NO microphone)
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (videoErr) {
      // 3. Fallback to audio-only (e.g., microphone exists, but NO camera)
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (audioErr) {
        // If everything fails, throw the original error to display in the UI
        throw err;
      }
    }
  }
}

// ─── How long each side waits for the remote stream before giving up (ms) ─────
const CALL_TIMEOUT_MS = 60_000;

// ─── ICE servers ──────────────────────────────────────────────────────────────
// We include several public STUN servers plus the free Open Relay TURN service.
// TURN is essential for peers behind symmetric NAT / corporate firewalls —
// without it, WebRTC degrades to "connecting forever" for those users.
const ICE_SERVERS: RTCIceServer[] = [
  // Google STUN
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
  // Open Relay — free public TURN (no signup required, rate-limited)
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
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

  // ── Wire up a data connection (used by both caller & receiver) ──────────────
  // NOTE: We only register the connection in the store AFTER it is open so that
  // ChatInterface's `canSend` guard (dataConnection && status==='connected')
  // only becomes true once the channel is actually ready to send.
  const wireDataConnection = useCallback(
    (conn: DataConnection) => {
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
        setDataConnection(null);
        // Only drop back to ready if we are not mid-call
        const s = usePeerStore.getState().status;
        if (s !== "connected" && s !== "calling") {
          setStatus("ready");
        }
      };

      conn.on("data", onData);
      conn.on("close", onClose);
      conn.on("error", () => setDataConnection(null));

      // Only mark connection as ready once the channel is actually open.
      // If already open (e.g. the caller side receives its own outbound conn
      // back), set it immediately.
      if (conn.open) {
        setDataConnection(conn);
      } else {
        conn.on("open", () => setDataConnection(conn));
      }
    },
    [setDataConnection, addMessage, setStatus],
  );

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
        wireDataConnection(conn);
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

// ─── Exported call-action hooks ────────────────────────────────────────────────

export function useCallActions() {
  const store = usePeerStore();

  // ── OUTGOING CALL ────────────────────────────────────────────────────────────
  const startCall = useCallback(async () => {
    const { peer, remotePeerId, setError } = store;
    if (!peer || !remotePeerId) return;

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

    store.setLocalStream(stream);
    store.setHasLocalVideo(stream.getVideoTracks().length > 0);
    store.setStatus("calling");

    // ── Media call ─────────────────────────────────────────────────────────
    const call = peer.call(remotePeerId, stream);
    store.setMediaCall(call);

    // ── Timeout: give up if receiver doesn't answer ─────────────────────────
    const timeoutId = setTimeout(() => {
      const s = usePeerStore.getState().status;
      if (s === "calling") {
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
      store.setRemoteStream(remoteStream);
      store.setHasRemoteVideo(remoteStream.getVideoTracks().length > 0);
      store.setStatus("connected");

      // ── Open data channel after media connection is established ───────────────────────────
      // The caller opens ONE outbound DataConnection after media is connected.
      // The receiver will get it via the peer "connection" event.
      const conn = peer.connect(remotePeerId, { reliable: true });
      conn.on("data", (raw) => {
        try {
          const parsed = JSON.parse(raw as string) as { text: string };
          store.addMessage({
            id: crypto.randomUUID(),
            from: "them",
            text: parsed.text,
            timestamp: new Date(),
          });
        } catch {
          /* ignore */
        }
      });
      conn.on("close", () => store.setDataConnection(null));
      conn.on("error", () => store.setDataConnection(null));
      // Only register as ready once open
      conn.on("open", () => store.setDataConnection(conn));
    });
  }, [store]);

  // ── ACCEPT INCOMING CALL ────────────────────────────────────────────────────
  const acceptCall = useCallback(async () => {
    const { incomingCall, peer, remotePeerId, setError } = store;
    if (!incomingCall) return;

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

    store.setLocalStream(stream);
    store.setHasLocalVideo(stream.getVideoTracks().length > 0);

    // Attach event handlers before answering, to avoid missing early events.
    const answererTimeout = setTimeout(() => {
      const s = usePeerStore.getState().status;
      if (s === "calling") {
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
      store.setRemoteStream(remoteStream);
      store.setHasRemoteVideo(remoteStream.getVideoTracks().length > 0);
      store.setStatus("connected");
    });
    incomingCall.on("close", () => {
      clearTimeout(answererTimeout);
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

    incomingCall.answer(stream);
    store.setMediaCall(incomingCall);
    store.setIncomingCall(null);
    store.setStatus("calling"); // Receiver is now in calling state while connecting

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

    const conn = peer.connect(remotePeerId, { reliable: true });
    store.setDataConnection(conn);
    store.setStatus("connected");
    if (!store.isChatOpen) store.toggleChat();

    conn.on("data", (raw) => {
      try {
        const parsed = JSON.parse(raw as string) as { text: string };
        store.addMessage({
          id: crypto.randomUUID(),
          from: "them",
          text: parsed.text,
          timestamp: new Date(),
        });
      } catch {
        /* ignore */
      }
    });
    conn.on("close", () => {
      store.setDataConnection(null);
      store.setStatus("ready");
    });
  }, [store]);

  // ── END CALL / DISCONNECT ───────────────────────────────────────────────────
  const endCall = useCallback(() => {
    const { mediaCall, dataConnection, localStream, incomingCall } = store;
    mediaCall?.close();
    dataConnection?.close();
    incomingCall?.close();
    // Stop all local tracks explicitly before reset
    localStream?.getTracks().forEach((t) => t.stop());
    store.setLocalStream(null);
    store.reset();
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
