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
  /** Tracks whether remote has video (not just stream existence) */
  hasRemoteVideo: boolean;
  /** Tracks whether local has video (not just stream existence) */
  hasLocalVideo: boolean;

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
  setHasRemoteVideo: (has: boolean) => void;
  setHasLocalVideo: (has: boolean) => void;
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
  hasRemoteVideo: false,
  hasLocalVideo: false,
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
  setHasRemoteVideo: (has) => set({ hasRemoteVideo: has }),
  setHasLocalVideo: (has) => set({ hasLocalVideo: has }),
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
    if (localStream && localStream.getAudioTracks().length > 0) {
      // isMuted is visual state: true=shown as muted, false=shown as unmuted
      // track.enabled is actual state: false=no audio, true=audio flowing
      // They should be OPPOSITE: enabled = !isMuted
      const newMutedState = !isMuted;
      localStream.getAudioTracks().forEach((t) => {
        t.enabled = !newMutedState; // If muting, disable tracks. If unmuting, enable tracks.
      });
      set({ isMuted: newMutedState });
    }
  },

  toggleCamera: () => {
    const { localStream, isCameraOff } = get();
    if (localStream && localStream.getVideoTracks().length > 0) {
      // isCameraOff is visual state: true=shown as off, false=shown as on
      // track.enabled is actual state: false=no video, true=video flowing
      // They should be OPPOSITE: enabled = !isCameraOff
      const newCameraOffState = !isCameraOff;
      localStream.getVideoTracks().forEach((t) => {
        t.enabled = !newCameraOffState; // If turning off, disable tracks. If turning on, enable tracks.
      });
      set({ isCameraOff: newCameraOffState });
    }
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
        remoteStream: null,
        hasRemoteVideo: false,
        hasLocalVideo: false,
        dataConnection: null,
        mediaCall: null,
        incomingCall: null,
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
