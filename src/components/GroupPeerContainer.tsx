"use client";

import { useEffect, useCallback, useRef } from "react";
import { usePeerStore } from "@/store/usePeerStore";
import { useGroupStore, type GroupChatMessage } from "@/store/useGroupStore";
import type Peer from "peerjs";
import type { DataConnection, MediaConnection } from "peerjs";

// ─── Reuse ICE config from PeerContainer ──────────────────────────────────────
const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

const TURN_HOST_RAW = process.env.NEXT_PUBLIC_TURN_HOST ?? "";
const TURN_USER     = process.env.NEXT_PUBLIC_TURN_USER ?? "";
const TURN_PASS     = process.env.NEXT_PUBLIC_TURN_PASS ?? "";

function stripSchemeAndPort(host: string): string {
  return host.replace(/^(turns?:)(\/\/)?/, "").replace(/:\d+.*$/, "").trim();
}
const TURN_HOST = stripSchemeAndPort(TURN_HOST_RAW);
const hasPrivateTurn = !!(TURN_HOST && TURN_USER && TURN_PASS);

const privateTurnServers: RTCIceServer[] = hasPrivateTurn
  ? [{
      urls: [
        "turn:global.relay.metered.ca:80",
        "turn:global.relay.metered.ca:80?transport=tcp",
        "turns:global.relay.metered.ca:443?transport=tcp",
      ],
      username: TURN_USER,
      credential: TURN_PASS,
    }]
  : [];

const publicTurnServers: RTCIceServer[] = [{
  urls: [
    "turn:openrelay.metered.ca:80",
    "turn:openrelay.metered.ca:80?transport=tcp",
    "turn:openrelay.metered.ca:443?transport=tcp",
  ],
  username: "openrelayproject",
  credential: "openrelayproject",
}];

const ICE_SERVERS: RTCIceServer[] = [
  ...STUN_SERVERS,
  ...privateTurnServers,
  ...publicTurnServers,
];

const PEER_CONFIG: RTCConfiguration = {
  iceServers: ICE_SERVERS,
  iceTransportPolicy: "all",
  iceCandidatePoolSize: 10,
};

// ─── Best-effort media stream ─────────────────────────────────────────────────
async function getBestStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: true,
    });
  } catch {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: true });
    } catch {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (err) {
        throw err;
      }
    }
  }
}

// ─── Data channel protocol for group signaling ────────────────────────────────
// These messages are sent over PeerJS data connections to coordinate the mesh.
type GroupDataMessage =
  | { type: "chat"; text: string; displayName: string }
  | { type: "room-peers"; peers: string[]; roomId: string }
  | { type: "join-room"; peerId: string; roomId: string; displayName: string }
  | { type: "leave-room"; peerId: string }
  | { type: "mute-state"; isMuted: boolean };

// ─── GroupPeerContainer ───────────────────────────────────────────────────────
// This component wraps children and provides the group call lifecycle.
// It reuses the *existing* Peer instance from usePeerStore (created by PeerContainer).
// It listens for incoming calls/data connections and routes them to the group
// store when the group is active.
export default function GroupPeerContainer({ children }: { children: React.ReactNode }) {
  const handlerInstalledRef = useRef(false);

  useEffect(() => {
    // We piggyback on the peer already created by PeerContainer.
    // Poll briefly until it's available (usually instant).
    const interval = setInterval(() => {
      const peer = usePeerStore.getState().peer;
      if (!peer || handlerInstalledRef.current) return;
      handlerInstalledRef.current = true;
      clearInterval(interval);

      console.log("[GroupPeer] Installing group handlers on existing Peer");

      // Incoming call: if we're in a group room, auto-answer from any peer
      // that sent us a join-room message (i.e. they're in our participants map).
      peer.on("call", (call: MediaConnection) => {
        const gs = useGroupStore.getState();
        if (gs.groupStatus !== "in-room") return; // not our concern

        const remotePeerId = call.peer;
        console.log(`[GroupPeer] Incoming call from ${remotePeerId} — auto-answering for group`);

        const localStream = gs.localStream ?? new MediaStream();
        call.answer(localStream);

        // Add participant if not already tracked
        if (!gs.participants.has(remotePeerId)) {
          useGroupStore.getState().addParticipant({
            peerId: remotePeerId,
            displayName: remotePeerId.slice(0, 8),
            remoteStream: null,
            mediaCall: call,
            dataConnection: null,
            hasVideo: false,
            hasAudio: false,
            isMuted: false,
            joinedAt: new Date(),
          });
        }

        call.on("stream", (remoteStream: MediaStream) => {
          console.log(`[GroupPeer] ✅ Got remote stream from ${remotePeerId}`);
          useGroupStore.getState().updateParticipant(remotePeerId, {
            remoteStream,
            mediaCall: call,
            hasVideo: remoteStream.getVideoTracks().length > 0,
            hasAudio: remoteStream.getAudioTracks().length > 0,
          });
        });

        call.on("close", () => {
          console.log(`[GroupPeer] Call closed with ${remotePeerId}`);
          useGroupStore.getState().removeParticipant(remotePeerId);
        });

        call.on("error", (err: Error) => {
          console.warn(`[GroupPeer] Call error with ${remotePeerId}:`, err);
          useGroupStore.getState().removeParticipant(remotePeerId);
        });
      });

      // Incoming data connection: route to group if in room, set up chat relay
      peer.on("connection", (conn: DataConnection) => {
        const gs = useGroupStore.getState();
        if (gs.groupStatus !== "in-room") return;

        console.log(`[GroupPeer] Incoming data connection from ${conn.peer}`);
        setupGroupDataConnection(conn);
      });
    }, 200);

    return () => clearInterval(interval);
  }, []);

  return <>{children}</>;
}

// ─── Set up a data connection for group messaging ─────────────────────────────
function setupGroupDataConnection(conn: DataConnection) {
  const handleOpen = () => {
    console.log(`[GroupPeer] ✅ Data connection open with ${conn.peer}`);
    useGroupStore.getState().updateParticipant(conn.peer, {
      dataConnection: conn,
    });
  };

  const handleData = (raw: unknown) => {
    try {
      const msg = JSON.parse(raw as string) as GroupDataMessage;

      switch (msg.type) {
        case "chat":
          useGroupStore.getState().addGroupMessage({
            id: crypto.randomUUID(),
            from: conn.peer,
            displayName: msg.displayName || conn.peer.slice(0, 8),
            text: msg.text,
            timestamp: new Date(),
          });
          break;

        case "room-peers":
          // A peer told us about other peers in the room — connect to them
          handlePeerDiscovery(msg.peers, msg.roomId);
          break;

        case "join-room":
          // A new peer is joining our room — call them
          handleNewPeerJoining(msg.peerId, msg.displayName);
          break;

        case "leave-room":
          console.log(`[GroupPeer] Peer ${msg.peerId} left the room`);
          useGroupStore.getState().removeParticipant(msg.peerId);
          break;

        case "mute-state":
          useGroupStore.getState().updateParticipant(conn.peer, {
            isMuted: msg.isMuted,
          });
          break;
      }
    } catch { /* ignore malformed */ }
  };

  const handleClose = () => {
    console.log(`[GroupPeer] Data connection closed with ${conn.peer}`);
    useGroupStore.getState().updateParticipant(conn.peer, {
      dataConnection: null,
    });
  };

  conn.on("data", handleData);
  conn.on("close", handleClose);
  conn.on("error", (err) => {
    console.warn(`[GroupPeer] Data connection error with ${conn.peer}:`, err);
  });

  if (conn.open) {
    handleOpen();
  } else {
    conn.on("open", handleOpen);
  }
}

// ─── Connect to a newly discovered peer ──────────────────────────────────────
function handlePeerDiscovery(peerIds: string[], _roomId: string) {
  const gs = useGroupStore.getState();
  const myId = usePeerStore.getState().myId;
  const peer = usePeerStore.getState().peer;
  if (!peer) return;

  for (const remotePeerId of peerIds) {
    if (remotePeerId === myId) continue;
    if (gs.participants.has(remotePeerId)) continue;

    console.log(`[GroupPeer] Discovered peer ${remotePeerId}, connecting...`);
    connectToPeer(peer, remotePeerId, gs.localStream);
  }
}

// ─── Handle a new peer announcing they joined ────────────────────────────────
function handleNewPeerJoining(peerId: string, displayName: string) {
  const gs = useGroupStore.getState();
  const myId = usePeerStore.getState().myId;
  const peer = usePeerStore.getState().peer;
  if (!peer || peerId === myId) return;
  if (gs.participants.has(peerId)) return;

  console.log(`[GroupPeer] New peer joining: ${peerId} (${displayName})`);
  connectToPeer(peer, peerId, gs.localStream);
}

// ─── Establish media + data connection to a remote peer ──────────────────────
function connectToPeer(
  peer: Peer,
  remotePeerId: string,
  localStream: MediaStream | null,
) {
  const stream = localStream ?? new MediaStream();

  // Add participant placeholder immediately
  useGroupStore.getState().addParticipant({
    peerId: remotePeerId,
    displayName: remotePeerId.slice(0, 8),
    remoteStream: null,
    mediaCall: null,
    dataConnection: null,
    hasVideo: false,
    hasAudio: false,
    isMuted: false,
    joinedAt: new Date(),
  });

  // Media call
  const call = peer.call(remotePeerId, stream);

  call.on("stream", (remoteStream: MediaStream) => {
    console.log(`[GroupPeer] ✅ Got remote stream from ${remotePeerId}`);
    useGroupStore.getState().updateParticipant(remotePeerId, {
      remoteStream,
      mediaCall: call,
      hasVideo: remoteStream.getVideoTracks().length > 0,
      hasAudio: remoteStream.getAudioTracks().length > 0,
    });
  });

  call.on("close", () => {
    useGroupStore.getState().removeParticipant(remotePeerId);
  });

  call.on("error", (err: Error) => {
    console.warn(`[GroupPeer] Call error to ${remotePeerId}:`, err);
    useGroupStore.getState().removeParticipant(remotePeerId);
  });

  // Data channel
  const conn = peer.connect(remotePeerId, { reliable: true, serialization: "json" });
  setupGroupDataConnection(conn);
}

// ─── useGroupCallActions hook ─────────────────────────────────────────────────
export function useGroupCallActions() {
  const groupStore = useGroupStore();

  // Create a new room (just you, waiting for others to join manually)
  const createRoom = useCallback(async (displayName?: string) => {
    const peer = usePeerStore.getState().peer;
    const myId = usePeerStore.getState().myId;
    if (!peer || !myId) return;

    groupStore.setGroupStatus("joining");
    if (displayName) groupStore.setMyDisplayName(displayName);

    // Get local media
    try {
      const stream = await getBestStream();
      groupStore.setLocalStream(stream);
      groupStore.setHasLocalVideo(stream.getVideoTracks().length > 0);
    } catch (err) {
      console.error("[GroupPeer] Media access failed:", err);
      groupStore.setGroupError("Failed to access camera/microphone.");
      return;
    }

    // Room ID = our own peer ID (simplest approach — share this to join)
    const roomId = myId;
    groupStore.setRoomId(roomId);
    groupStore.setGroupStatus("in-room");
    console.log(`[GroupPeer] ✅ Room created: ${roomId}`);
  }, [groupStore]);

  // Join an existing room by connecting to the room creator's peer ID
  const joinRoom = useCallback(async (roomPeerId: string, displayName?: string) => {
    const peer = usePeerStore.getState().peer;
    const myId = usePeerStore.getState().myId;
    if (!peer || !myId || !roomPeerId) return;
    if (roomPeerId === myId) {
      // They're trying to join their own room — just create it
      createRoom(displayName);
      return;
    }

    groupStore.setGroupStatus("joining");
    if (displayName) groupStore.setMyDisplayName(displayName);
    groupStore.setRoomId(roomPeerId);

    // Get local media
    try {
      const stream = await getBestStream();
      groupStore.setLocalStream(stream);
      groupStore.setHasLocalVideo(stream.getVideoTracks().length > 0);
    } catch (err) {
      console.error("[GroupPeer] Media access failed:", err);
      groupStore.setGroupError("Failed to access camera/microphone.");
      return;
    }

    groupStore.setGroupStatus("in-room");

    // Connect to the room host — they'll send us "room-peers" with everyone else
    connectToPeer(peer, roomPeerId, groupStore.localStream);

    // Announce ourselves to the host so they can broadcast to others
    const conn = peer.connect(roomPeerId, { reliable: true, serialization: "json" });
    conn.on("open", () => {
      const msg: GroupDataMessage = {
        type: "join-room",
        peerId: myId,
        roomId: roomPeerId,
        displayName: displayName || myId.slice(0, 8),
      };
      conn.send(JSON.stringify(msg));

      // After announcing, the host will call us back. The auto-answer
      // handler in the useEffect above will pick it up.
    });

    console.log(`[GroupPeer] Joining room ${roomPeerId}...`);
  }, [groupStore, createRoom]);

  // Invite a specific peer ID into the current room
  const invitePeer = useCallback((remotePeerId: string) => {
    const peer = usePeerStore.getState().peer;
    const gs = useGroupStore.getState();
    if (!peer || gs.groupStatus !== "in-room") return;
    if (gs.participants.has(remotePeerId)) return;

    connectToPeer(peer, remotePeerId, gs.localStream);

    // Tell the new peer about all existing participants
    setTimeout(() => {
      const participant = useGroupStore.getState().participants.get(remotePeerId);
      if (participant?.dataConnection) {
        const existingPeerIds = Array.from(useGroupStore.getState().participants.keys());
        const msg: GroupDataMessage = {
          type: "room-peers",
          peers: [usePeerStore.getState().myId, ...existingPeerIds],
          roomId: gs.roomId,
        };
        participant.dataConnection.send(JSON.stringify(msg));
      }
    }, 2000);
  }, []);

  // Leave room gracefully
  const leaveRoom = useCallback(() => {
    const gs = useGroupStore.getState();
    const myId = usePeerStore.getState().myId;

    // Notify all participants
    gs.participants.forEach((p) => {
      if (p.dataConnection) {
        const msg: GroupDataMessage = { type: "leave-room", peerId: myId };
        try { p.dataConnection.send(JSON.stringify(msg)); } catch { /* ignore */ }
      }
    });

    groupStore.resetGroup();
    console.log("[GroupPeer] Left room");
  }, [groupStore]);

  // Send a group chat message (broadcast to all participants)
  const sendGroupMessage = useCallback((text: string) => {
    const gs = useGroupStore.getState();
    if (!text.trim()) return;

    const msg: GroupDataMessage = {
      type: "chat",
      text: text.trim(),
      displayName: gs.myDisplayName,
    };
    const payload = JSON.stringify(msg);

    // Send to every connected participant
    gs.participants.forEach((p) => {
      if (p.dataConnection) {
        try { p.dataConnection.send(payload); } catch { /* ignore */ }
      }
    });

    // Add to our own history
    gs.addGroupMessage({
      id: crypto.randomUUID(),
      from: "me",
      displayName: gs.myDisplayName,
      text: text.trim(),
      timestamp: new Date(),
    });
  }, []);

  return { createRoom, joinRoom, invitePeer, leaveRoom, sendGroupMessage };
}
