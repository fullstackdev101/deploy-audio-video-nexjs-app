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

  addMessage: (msg) =>
    set((state) => ({ chatHistory: [...state.chatHistory, msg] })),

  toggleMute: () => {
    const { localStream, isMuted } = get();
    if (localStream) {
      localStream.getAudioTracks().forEach((t) => (t.enabled = isMuted));
    }
    set({ isMuted: !isMuted });
  },

  toggleCamera: () => {
    const { localStream, isCameraOff } = get();
    if (localStream) {
      localStream.getVideoTracks().forEach((t) => (t.enabled = isCameraOff));
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
      };
    }),
}));
