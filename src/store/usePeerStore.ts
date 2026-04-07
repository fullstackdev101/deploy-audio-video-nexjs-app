import { create } from "zustand";
import type Peer from "peerjs";
import type { DataConnection, MediaConnection } from "peerjs";

export type ConnectionStatus =
  | "idle"
  | "initializing"
  | "ready"
  | "calling"
  | "incoming"
  | "connected"
  | "declined"
  | "error";

export interface ChatMessage {
  id: string;
  from: "me" | "them";
  text: string;
  timestamp: Date;
}

interface PeerState {
  // Peer core
  peer: Peer | null;
  myId: string;

  // Streams
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;

  // Connections
  dataConnection: DataConnection | null;
  mediaCall: MediaConnection | null;
  /** Pending incoming call awaiting accept/decline */
  incomingCall: MediaConnection | null;

  // Chat
  chatHistory: ChatMessage[];

  // Status
  status: ConnectionStatus;
  remotePeerId: string;
  isMuted: boolean;
  isCameraOff: boolean;
  isChatOpen: boolean;
  videoFit: "cover" | "contain";
  errorMessage: string;
  /** True when we accepted an incoming call (receiver side) */
  isAnswering: boolean;

  // Actions
  setPeer: (peer: Peer) => void;
  setMyId: (id: string) => void;
  setLocalStream: (stream: MediaStream | null) => void;
  setRemoteStream: (stream: MediaStream | null) => void;
  setDataConnection: (conn: DataConnection | null) => void;
  setMediaCall: (call: MediaConnection | null) => void;
  setIncomingCall: (call: MediaConnection | null) => void;
  setStatus: (status: ConnectionStatus) => void;
  setRemotePeerId: (id: string) => void;
  setIsAnswering: (v: boolean) => void;
  addMessage: (msg: ChatMessage) => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleChat: () => void;
  toggleVideoFit: () => void;
  setError: (msg: string) => void;
  reset: () => void;
}

const initialState = {
  peer: null,
  myId: "",
  localStream: null,
  remoteStream: null,
  dataConnection: null,
  mediaCall: null,
  incomingCall: null,
  chatHistory: [],
  status: "idle" as ConnectionStatus,
  remotePeerId: "",
  isMuted: false,
  isCameraOff: false,
  isChatOpen: false,
  videoFit: "cover" as const,
  errorMessage: "",
  isAnswering: false,
};

export const usePeerStore = create<PeerState>((set, get) => ({
  ...initialState,

  setPeer: (peer) => set({ peer }),
  setMyId: (id) => set({ myId: id }),
  setLocalStream: (stream) => set({ localStream: stream }),
  setRemoteStream: (stream) => set({ remoteStream: stream }),
  setDataConnection: (conn) => set({ dataConnection: conn }),
  setMediaCall: (call) => set({ mediaCall: call }),
  setIncomingCall: (call) => set({ incomingCall: call }),
  setStatus: (status) => set({ status }),
  setRemotePeerId: (id) => set({ remotePeerId: id }),
  setIsAnswering: (v) => set({ isAnswering: v }),

  addMessage: (msg) =>
    set((state) => ({ chatHistory: [...state.chatHistory, msg] })),

  toggleMute: () => {
    const { localStream, isMuted } = get();
    if (localStream) {
      // isMuted is the CURRENT state; we're toggling TO the opposite.
      // If currently muted (isMuted=true) → we want to UN-mute → enable track.
      // If currently unmuted (isMuted=false) → we want to MUTE → disable track.
      localStream.getAudioTracks().forEach((t) => (t.enabled = isMuted)); // isMuted=true means "was muted" → enable now
    }
    set({ isMuted: !isMuted });
  },

  toggleCamera: () => {
    const { localStream, isCameraOff } = get();
    if (localStream) {
      // isCameraOff is the CURRENT state; we're toggling TO the opposite.
      // If camera is off (isCameraOff=true) → enabling → set enabled=true.
      // If camera is on (isCameraOff=false) → disabling → set enabled=false.
      localStream.getVideoTracks().forEach((t) => (t.enabled = isCameraOff)); // isCameraOff=true means "was off" → enable now
    }
    set({ isCameraOff: !isCameraOff });
  },

  toggleChat: () => set((s) => ({ isChatOpen: !s.isChatOpen })),
  toggleVideoFit: () =>
    set((s) => ({ videoFit: s.videoFit === "cover" ? "contain" : "cover" })),

  setError: (msg) => set({ errorMessage: msg, status: "error" }),

  reset: () =>
    set((state) => {
      // Stop any lingering local tracks
      state.localStream?.getTracks().forEach((t) => t.stop());
      // Decline any pending incoming call cleanly
      state.incomingCall?.close();
      return {
        localStream: null,
        dataConnection: null,
        mediaCall: null,
        incomingCall: null,
        remoteStream: null,
        // chatHistory intentionally preserved — messages survive call end
        status: "ready",
        remotePeerId: "",
        isMuted: false,
        isCameraOff: false,
        isChatOpen: false,
        errorMessage: "",
        isAnswering: false,
      };
    }),
}));
