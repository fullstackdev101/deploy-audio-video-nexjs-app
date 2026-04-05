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

// ─── Get best available stream: video+audio → audio-only → throw ─────────────
async function getBestStream(): Promise<MediaStream> {
  // First try: full video + audio
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });
  } catch (videoErr) {
    const name = (videoErr as Error).name;

    // If the error was a hard block (denied/not found for audio), rethrow
    if (
      name === "NotAllowedError" ||
      name === "PermissionDeniedError"
    ) {
      throw videoErr;
    }

    // Fallback: audio-only (no camera available / camera in use)
    try {
      console.warn("Video unavailable, falling back to audio-only:", videoErr);
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (audioErr) {
      // Both failed — throw the original video error for a better message
      throw videoErr ?? audioErr;
    }
  }
}

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
    setStatus,
    addMessage,
    setError,
  } = usePeerStore();

  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // Setup an incoming DataConnection
  const setupDataConnection = useCallback(
    (conn: DataConnection) => {
      setDataConnection(conn);
      conn.on("data", (raw) => {
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
      });
      conn.on("close", () => {
        setDataConnection(null);
        setStatus("ready");
      });
      conn.on("error", () => setDataConnection(null));
    },
    [setDataConnection, addMessage, setStatus]
  );

  // Setup an incoming MediaCall (answer)
  const setupMediaCall = useCallback(
    async (call: MediaConnection) => {
      // Guard: require getUserMedia API
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Your browser does not support media devices (use HTTPS or a modern browser).");
        return;
      }

      try {
        const stream = await getBestStream();
        localStreamRef.current = stream;
        setLocalStream(stream);
        call.answer(stream);
        setMediaCall(call);
        setStatus("connected");

        call.on("stream", (remoteStream) => {
          setRemoteStream(remoteStream);
        });
        call.on("close", () => {
          setRemoteStream(null);
          setMediaCall(null);
          setStatus("ready");
        });
        call.on("error", () => {
          setRemoteStream(null);
          setMediaCall(null);
          setStatus("ready");
        });

        // Open a data channel back to the caller for text chat
        // (caller also opens one; the peer.on('connection') handler will wire
        //  the caller's channel in setupDataConnection automatically)
      } catch (err) {
        console.error("[PeerLink] setupMediaCall error:", err);
        setError(mediaErrorMessage(err));
      }
    },
    [setLocalStream, setMediaCall, setRemoteStream, setStatus, setError]
  );

  useEffect(() => {
    let peerInstance: Peer;

    const init = async () => {
      setStatus("initializing");

      // Dynamic import — PeerJS is browser-only
      const { default: PeerJS } = await import("peerjs");

      peerInstance = new PeerJS(undefined as unknown as string, {
        debug: 1,
      });

      peerRef.current = peerInstance;
      setPeer(peerInstance);

      peerInstance.on("open", (id) => {
        setMyId(id);
        setStatus("ready");
      });

      peerInstance.on("connection", (conn) => {
        setupDataConnection(conn);
      });

      peerInstance.on("call", (call) => {
        setStatus("incoming");
        setupMediaCall(call);
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

  const startCall = useCallback(async () => {
    const { peer, remotePeerId, setError } = store;
    if (!peer || !remotePeerId) return;

    // Guard: require getUserMedia API (needs HTTPS outside localhost)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Media devices are not available. Make sure you are using HTTPS or localhost."
      );
      return;
    }

    try {
      const stream = await getBestStream();
      store.setLocalStream(stream);
      store.setStatus("calling");

      // ── 1. Media call ──────────────────────────────────────────────────────
      const call = peer.call(remotePeerId, stream);
      store.setMediaCall(call);

      call.on("stream", (remoteStream) => {
        store.setRemoteStream(remoteStream);
        store.setStatus("connected");
      });
      call.on("close", () => {
        store.setRemoteStream(null);
        store.setMediaCall(null);
        store.setStatus("ready");
      });
      call.on("error", (err) => {
        console.error("[PeerLink] call error:", err);
        store.setRemoteStream(null);
        store.setMediaCall(null);
        store.setStatus("ready");
      });

      // ── 2. Data channel (text chat) alongside the video call ───────────────
      // Only open if we don't already have one (e.g. from a prior startTextChat)
      if (!store.dataConnection) {
        const conn = peer.connect(remotePeerId, { reliable: true });
        store.setDataConnection(conn);
        conn.on("data", (raw) => {
          try {
            const parsed = JSON.parse(raw as string) as { text: string };
            store.addMessage({
              id: crypto.randomUUID(),
              from: "them",
              text: parsed.text,
              timestamp: new Date(),
            });
          } catch { /* ignore */ }
        });
        conn.on("close", () => {
          store.setDataConnection(null);
        });
      }
    } catch (err) {
      console.error("[PeerLink] startCall getUserMedia error:", err);
      store.setError(mediaErrorMessage(err));
    }
  }, [store]);

  const startTextChat = useCallback(() => {
    const { peer, remotePeerId } = store;
    if (!peer || !remotePeerId) return;

    const conn = peer.connect(remotePeerId, { reliable: true });
    store.setDataConnection(conn);
    store.setStatus("connected");
    store.toggleChat();

    conn.on("data", (raw) => {
      try {
        const parsed = JSON.parse(raw as string) as { text: string };
        const msg: ChatMessage = {
          id: crypto.randomUUID(),
          from: "them",
          text: parsed.text,
          timestamp: new Date(),
        };
        store.addMessage(msg);
      } catch {
        /* ignore */
      }
    });
    conn.on("close", () => {
      store.setDataConnection(null);
      store.setStatus("ready");
    });
  }, [store]);

  const endCall = useCallback(() => {
    const { mediaCall, dataConnection, localStream } = store;
    mediaCall?.close();
    dataConnection?.close();
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
    }
    store.setLocalStream(null);
    store.reset();
  }, [store]);

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
    [store]
  );

  return { startCall, startTextChat, endCall, sendMessage };
}
