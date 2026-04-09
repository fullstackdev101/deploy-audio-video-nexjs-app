import { create } from "zustand";
import type { DataConnection, MediaConnection } from "peerjs";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GroupChatMessage {
  id: string;
  from: string;        // peerId of sender, or "me"
  displayName: string; // human label shown in UI
  text: string;
  timestamp: Date;
}

export interface GroupParticipant {
  peerId: string;
  displayName: string;
  remoteStream: MediaStream | null;
  mediaCall: MediaConnection | null;
  dataConnection: DataConnection | null;
  hasVideo: boolean;
  hasAudio: boolean;
  isMuted: boolean;     // their self-reported mute state (via data channel)
  joinedAt: Date;
}

export type GroupStatus =
  | "idle"
  | "joining"
  | "in-room"
  | "leaving"
  | "error";

// ─── State interface ──────────────────────────────────────────────────────────

interface GroupState {
  // Room metadata
  roomId: string;
  myDisplayName: string;
  groupStatus: GroupStatus;
  groupError: string;

  // Participants (keyed by peerId)
  participants: Map<string, GroupParticipant>;

  // Local media (shared with group)
  localStream: MediaStream | null;
  hasLocalVideo: boolean;
  isMuted: boolean;
  isCameraOff: boolean;

  // Group chat
  chatHistory: GroupChatMessage[];
  isChatOpen: boolean;

  // Actions — room
  setRoomId: (id: string) => void;
  setMyDisplayName: (name: string) => void;
  setGroupStatus: (status: GroupStatus) => void;
  setGroupError: (msg: string) => void;

  // Actions — participants
  addParticipant: (p: GroupParticipant) => void;
  removeParticipant: (peerId: string) => void;
  updateParticipant: (peerId: string, update: Partial<GroupParticipant>) => void;
  getParticipant: (peerId: string) => GroupParticipant | undefined;

  // Actions — local media
  setLocalStream: (s: MediaStream | null) => void;
  setHasLocalVideo: (v: boolean) => void;
  toggleGroupMute: () => void;
  toggleGroupCamera: () => void;

  // Actions — chat
  addGroupMessage: (msg: GroupChatMessage) => void;
  toggleGroupChat: () => void;

  // Reset
  resetGroup: () => void;
}

// ─── Initial state ────────────────────────────────────────────────────────────

const initialState = {
  roomId: "",
  myDisplayName: "You",
  groupStatus: "idle" as GroupStatus,
  groupError: "",
  participants: new Map<string, GroupParticipant>(),
  localStream: null,
  hasLocalVideo: false,
  isMuted: false,
  isCameraOff: false,
  chatHistory: [] as GroupChatMessage[],
  isChatOpen: false,
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useGroupStore = create<GroupState>((set, get) => ({
  ...initialState,

  setRoomId: (id) => set({ roomId: id }),
  setMyDisplayName: (name) => set({ myDisplayName: name }),
  setGroupStatus: (status) => set({ groupStatus: status }),
  setGroupError: (msg) => set({ groupError: msg, groupStatus: "error" }),

  addParticipant: (p) =>
    set((state) => {
      const next = new Map(state.participants);
      next.set(p.peerId, p);
      return { participants: next };
    }),

  removeParticipant: (peerId) =>
    set((state) => {
      const next = new Map(state.participants);
      const p = next.get(peerId);
      // Clean up media gracefully before removing
      p?.mediaCall?.close();
      p?.dataConnection?.close();
      next.delete(peerId);
      return { participants: next };
    }),

  updateParticipant: (peerId, update) =>
    set((state) => {
      const existing = state.participants.get(peerId);
      if (!existing) return {};
      const next = new Map(state.participants);
      next.set(peerId, { ...existing, ...update });
      return { participants: next };
    }),

  getParticipant: (peerId) => get().participants.get(peerId),

  setLocalStream: (s) => set({ localStream: s }),
  setHasLocalVideo: (v) => set({ hasLocalVideo: v }),

  toggleGroupMute: () => {
    const { localStream, isMuted } = get();
    if (localStream) {
      const newMuted = !isMuted;
      localStream.getAudioTracks().forEach((t) => {
        t.enabled = !newMuted;
      });
      set({ isMuted: newMuted });
    }
  },

  toggleGroupCamera: () => {
    const { localStream, isCameraOff } = get();
    if (localStream) {
      const newOff = !isCameraOff;
      localStream.getVideoTracks().forEach((t) => {
        t.enabled = !newOff;
      });
      set({ isCameraOff: newOff });
    }
  },

  addGroupMessage: (msg) =>
    set((state) => ({ chatHistory: [...state.chatHistory, msg] })),

  toggleGroupChat: () => set((s) => ({ isChatOpen: !s.isChatOpen })),

  resetGroup: () =>
    set((state) => {
      // Gracefully stop all participant connections
      state.participants.forEach((p) => {
        p.mediaCall?.close();
        p.dataConnection?.close();
      });
      // Stop local tracks
      state.localStream?.getTracks().forEach((t) => t.stop());
      return {
        ...initialState,
        participants: new Map(),
        chatHistory: [],
      };
    }),
}));
