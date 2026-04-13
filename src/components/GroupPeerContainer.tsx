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
const TURN_USER = process.env.NEXT_PUBLIC_TURN_USER ?? "";
const TURN_PASS = process.env.NEXT_PUBLIC_TURN_PASS ?? "";

function stripSchemeAndPort(host: string): string {
  return host
    .replace(/^(turns?:)(\/\/)?/, "")
    .replace(/:\d+.*$/, "")
    .trim();
}
const TURN_HOST = stripSchemeAndPort(TURN_HOST_RAW);
const hasPrivateTurn = !!(TURN_HOST && TURN_USER && TURN_PASS);

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

// ── Startup diagnostics for group module ──────────────────────────────────────
if (typeof window !== "undefined") {
  if (hasPrivateTurn) {
    console.log(
      `%c[GroupPeer] ✅ TURN: using metered.ca private credentials (user: ${TURN_USER.slice(0, 8)}…)`,
      "color:#22c55e;font-weight:bold",
    );
  } else {
    console.warn(
      "%c[GroupPeer] ⚠️ TURN: public openrelay only — group calls on restrictive networks may fail.",
      "color:#f59e0b;font-weight:bold",
    );
  }
}

// ─── Best-effort media stream ─────────────────────────────────────────────────
async function getBestStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: true,
    });
  } catch (err) {
    const name = (err as Error).name;
    if (name === "NotAllowedError" || name === "PermissionDeniedError")
      throw err;
    console.warn(
      "[GroupPeer] Combined video+audio failed, trying fallbacks:",
      err,
    );
    try {
      console.log("[GroupPeer] Attempting video-only…");
      return await navigator.mediaDevices.getUserMedia({ video: true });
    } catch {
      console.warn("[GroupPeer] Video-only failed. Attempting audio-only…");
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        console.log("[GroupPeer] ✅ Audio-only fallback successful.");
        return s;
      } catch {
        console.error("[GroupPeer] All media access attempts failed.");
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
  | { type: "new-peer"; peerId: string; displayName: string } // creator → existing peers: "someone new joined, connect to them"
  | { type: "leave-room"; peerId: string }
  | { type: "mute-state"; isMuted: boolean };

// ─── Install group call event handlers on the peer ──────────────────────────
function installGroupHandlers(peer: Peer) {
  // Incoming call: if we're in a group room, auto-answer with our local stream.
  peer.on("call", (call: MediaConnection) => {
    const gs = useGroupStore.getState();
    if (gs.groupStatus !== "in-room") return; // not our concern

    const remotePeerId = call.peer;
    const localStream = gs.localStream;

    console.log(
      `[GroupPeer] Incoming call from ${remotePeerId} — local stream tracks: ${localStream?.getTracks().length || 0}`,
    );

    // Always answer, even with empty stream - data channel will handle signaling
    const answerStream = localStream || new MediaStream();
    console.log(
      `[GroupPeer] Answering call from ${remotePeerId} with ${answerStream.getTracks().length} tracks`,
    );
    call.answer(answerStream);

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
    } else {
      // Update existing participant with new call reference
      useGroupStore.getState().updateParticipant(remotePeerId, {
        mediaCall: call,
      });
    }

    setupMediaCallHandlers(call, remotePeerId);
  });

  // Incoming data connection: route to group if in room, set up chat relay.
  peer.on("connection", (conn: DataConnection) => {
    const gs = useGroupStore.getState();
    if (gs.groupStatus !== "in-room") return;

    if (!gs.participants.has(conn.peer)) {
      console.log(
        `[GroupPeer] Incoming data connection from unknown peer ${conn.peer}, creating placeholder participant`,
      );
      useGroupStore.getState().addParticipant({
        peerId: conn.peer,
        displayName: conn.peer.slice(0, 8),
        remoteStream: null,
        mediaCall: null,
        dataConnection: null,
        hasVideo: false,
        hasAudio: false,
        isMuted: false,
        joinedAt: new Date(),
      });
    }

    const existingParticipant = gs.participants.get(conn.peer);
    if (existingParticipant?.dataConnection) {
      console.log(
        `[GroupPeer] Already have data connection with ${conn.peer}, skipping duplicate`,
      );
      return;
    }

    console.log(`[GroupPeer] Incoming data connection from ${conn.peer}`);
    setupGroupDataConnection(conn);
  });
}

// ─── GroupPeerContainer ───────────────────────────────────────────────────────
// This component wraps children and provides the group call lifecycle.
// It reuses the *existing* Peer instance from usePeerStore (created by PeerContainer).
// It listens for incoming calls/data connections and routes them to the group
// store when the group is active.
export default function GroupPeerContainer({
  children,
}: {
  children: React.ReactNode;
}) {
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

      // Install group call handlers
      installGroupHandlers(peer);

      // Periodic connection health check for group calls
      const healthCheckInterval = setInterval(() => {
        const gs = useGroupStore.getState();
        if (gs.groupStatus !== "in-room") return;

        gs.participants.forEach((participant, peerId) => {
          // Check if connections are still alive
          if (
            participant.mediaCall &&
            participant.mediaCall.peerConnection?.connectionState === "failed"
          ) {
            console.warn(
              `[GroupPeer] Media connection to ${peerId} failed, attempting reconnect`,
            );
            useGroupStore.getState().updateParticipant(peerId, {
              mediaCall: null,
              remoteStream: null,
              hasVideo: false,
              hasAudio: false,
            });
            // Trigger reconnection
            const localStream = gs.localStream;
            if (localStream) {
              connectToPeer(peer, peerId, localStream);
            }
          }

          if (
            participant.dataConnection &&
            participant.dataConnection.peerConnection?.connectionState ===
              "failed"
          ) {
            console.warn(
              `[GroupPeer] Data connection to ${peerId} failed, attempting reconnect`,
            );
            useGroupStore
              .getState()
              .updateParticipant(peerId, { dataConnection: null });
            const conn = peer.connect(peerId, {
              reliable: true,
              serialization: "json",
            });
            setupGroupDataConnection(conn);
          }
        });
      }, 10000); // Check every 10 seconds

      // Cleanup health check on unmount
      return () => clearInterval(healthCheckInterval);
    }, 200);

    return () => clearInterval(interval);
  }, []);

  return <>{children}</>;
}

// ─── Set up media call event handlers ──────────────────────────────────────
function setupMediaCallHandlers(call: MediaConnection, remotePeerId: string) {
  call.on("stream", (remoteStream: MediaStream) => {
    console.log(
      `[GroupPeer] ✅ Got remote stream from ${remotePeerId} (${remoteStream.getVideoTracks().length} video, ${remoteStream.getAudioTracks().length} audio tracks)`,
    );

    // Update participant with stream info
    useGroupStore.getState().updateParticipant(remotePeerId, {
      remoteStream,
      mediaCall: call,
      hasVideo: remoteStream.getVideoTracks().length > 0,
      hasAudio: remoteStream.getAudioTracks().length > 0,
    });
  });

  call.on("close", () => {
    console.log(`[GroupPeer] Call closed with ${remotePeerId}`);
    useGroupStore.getState().updateParticipant(remotePeerId, {
      mediaCall: null,
      remoteStream: null,
      hasVideo: false,
      hasAudio: false,
    });
  });

  call.on("error", (err: Error) => {
    console.warn(`[GroupPeer] Call error with ${remotePeerId}:`, err);
    useGroupStore.getState().updateParticipant(remotePeerId, {
      mediaCall: null,
      remoteStream: null,
      hasVideo: false,
      hasAudio: false,
    });
  });
}

// ─── Set up a data connection for group messaging ─────────────────────────────
function setupGroupDataConnection(conn: DataConnection) {
  const handleOpen = () => {
    console.log(`[GroupPeer] ✅ Data connection open with ${conn.peer}`);
    const existingParticipant = useGroupStore
      .getState()
      .participants.get(conn.peer);
    if (!existingParticipant) {
      console.log(
        `[GroupPeer] Data connection open with unknown peer ${conn.peer}, creating placeholder participant`,
      );
      useGroupStore.getState().addParticipant({
        peerId: conn.peer,
        displayName: conn.peer.slice(0, 8),
        remoteStream: null,
        mediaCall: null,
        dataConnection: conn,
        hasVideo: false,
        hasAudio: false,
        isMuted: false,
        joinedAt: new Date(),
      });
    } else {
      useGroupStore.getState().updateParticipant(conn.peer, {
        dataConnection: conn,
      });
    }
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
          console.log(
            `[GroupPeer] Received room-peers:`,
            msg.peers,
            `roomId: ${msg.roomId}`,
          );
          // A peer told us about other peers in the room — connect to them
          handlePeerDiscovery(msg.peers, msg.roomId);
          break;

        case "join-room":
          console.log(
            `[GroupPeer] Received join-room from ${msg.peerId} (${msg.displayName})`,
          );
          // A new peer is joining our room — send them the full peer list
          // and notify all existing peers so the mesh is complete.
          handleNewPeerJoining(msg.peerId, msg.displayName);
          break;

        case "new-peer":
          console.log(
            `[GroupPeer] Received new-peer: ${msg.peerId} (${msg.displayName})`,
          );
          // Creator told us about another peer — connect to them
          handlePeerDiscovery([msg.peerId], "");
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
    } catch {
      /* ignore malformed */
    }
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
// Called by non-host peers when they receive room-peers or new-peer messages.
function handlePeerDiscovery(peerIds: string[], _roomId: string) {
  const myId = usePeerStore.getState().myId;
  const peer = usePeerStore.getState().peer;
  if (!peer) return;

  const localStream = useGroupStore.getState().localStream;

  console.log(
    `[GroupPeer] handlePeerDiscovery called with peers:`,
    peerIds,
    `myId: ${myId}`,
  );

  for (const remotePeerId of peerIds) {
    if (remotePeerId === myId) continue;

    const existing = useGroupStore.getState().participants.get(remotePeerId);
    if (existing?.mediaCall && existing?.dataConnection) {
      console.log(
        `[GroupPeer] Already fully connected to ${remotePeerId}, skipping`,
      );
      continue;
    }

    // Check if we need to retry connection
    if (existing?.mediaCall && !existing.dataConnection) {
      console.log(
        `[GroupPeer] Existing media call with ${remotePeerId} but no data channel yet — opening data only`,
      );
      const conn = peer.connect(remotePeerId, {
        reliable: true,
        serialization: "json",
      });
      setupGroupDataConnection(conn);
      continue;
    }

    console.log(`[GroupPeer] Connecting to discovered peer ${remotePeerId}`);
    connectToPeer(peer, remotePeerId, localStream);
  }
}

// ─── Handle a new peer announcing they joined (CREATOR only) ─────────────────
// When Peer B sends join-room to the creator:
//   1. Update Peer B's display name in our participants map.
//   2. Send Peer B the full list of everyone currently in the room so Peer B
//      can call them all directly (completing the mesh on Peer B's side).
//   3. Broadcast a new-peer notification to every existing participant so they
//      call Peer B directly (completing the mesh on everyone else's side).
function handleNewPeerJoining(peerId: string, displayName: string) {
  const myId = usePeerStore.getState().myId;
  const peer = usePeerStore.getState().peer;
  if (!peer || peerId === myId) return;

  const gs = useGroupStore.getState();

  console.log(`[GroupPeer] handleNewPeerJoining: ${peerId} (${displayName})`);

  if (!gs.participants.has(peerId)) {
    console.log(
      `[GroupPeer] Adding new participant ${peerId} to creator's store`,
    );
    useGroupStore.getState().addParticipant({
      peerId,
      displayName,
      remoteStream: null,
      mediaCall: null,
      dataConnection: null,
      hasVideo: false,
      hasAudio: false,
      isMuted: false,
      joinedAt: new Date(),
    });
  } else {
    console.log(
      `[GroupPeer] Updating existing participant ${peerId} display name`,
    );
    useGroupStore.getState().updateParticipant(peerId, { displayName });
  }

  // ── Step 1: Build the room-peers list (everyone except the new joiner) ──────
  // Include the creator (myId) so the joiner connects back to us.
  const existingPeerIds: string[] = [myId];
  gs.participants.forEach((_, pid) => {
    if (pid !== peerId) existingPeerIds.push(pid);
  });

  console.log(`[GroupPeer] Sending room-peers to ${peerId}:`, existingPeerIds);

  // ── Step 2: Send room-peers to the new joiner via their data connection ─────
  // Poll briefly because the data connection may not be stored yet.
  const sendRoomPeers = () => {
    const participant = useGroupStore.getState().participants.get(peerId);
    if (participant?.dataConnection) {
      const msg: GroupDataMessage = {
        type: "room-peers",
        peers: existingPeerIds,
        roomId: myId,
      };
      try {
        participant.dataConnection.send(JSON.stringify(msg));
        console.log(`[GroupPeer] ✅ Sent room-peers to ${peerId}`);
      } catch (e) {
        console.warn(`[GroupPeer] Failed to send room-peers to ${peerId}:`, e);
      }
      return true;
    }
    return false;
  };

  if (!sendRoomPeers()) {
    const retryInterval = setInterval(() => {
      if (sendRoomPeers()) clearInterval(retryInterval);
    }, 300);
    setTimeout(() => clearInterval(retryInterval), 10000);
  }

  // ── Step 3: Broadcast new-peer to every existing participant ─────────────────
  // This tells Peer C (and all others) about Peer B so they connect directly.
  const newPeerMsg: GroupDataMessage = {
    type: "new-peer",
    peerId,
    displayName,
  };
  const newPeerPayload = JSON.stringify(newPeerMsg);

  console.log(
    `[GroupPeer] Broadcasting new-peer ${peerId} to existing participants`,
  );

  gs.participants.forEach((participant, pid) => {
    if (pid === peerId) return; // don't send to the new joiner
    console.log(`[GroupPeer] Sending new-peer to ${pid}`);
    const sendNotification = () => {
      const p = useGroupStore.getState().participants.get(pid);
      if (p?.dataConnection) {
        try {
          p.dataConnection.send(newPeerPayload);
          console.log(
            `[GroupPeer] ✅ Sent new-peer ${peerId} notification to ${pid}`,
          );
        } catch (e) {
          console.warn(
            `[GroupPeer] Failed to notify ${pid} about new peer:`,
            e,
          );
        }
        return true;
      }
      return false;
    };

    if (!sendNotification()) {
      const retryInterval = setInterval(() => {
        if (sendNotification()) clearInterval(retryInterval);
      }, 300);
      setTimeout(() => clearInterval(retryInterval), 10000);
    }
  });
}

// ─── Establish media + data connection to a remote peer ──────────────────────
function connectToPeer(
  peer: Peer,
  remotePeerId: string,
  localStream: MediaStream | null,
) {
  const stream = localStream ?? new MediaStream();

  console.log(
    `[GroupPeer] connectToPeer → ${remotePeerId} (tracks: ${stream.getTracks().length}, video: ${stream.getVideoTracks().length}, audio: ${stream.getAudioTracks().length})`,
  );

  if (stream.getTracks().length === 0) {
    console.warn(
      `[GroupPeer] ⚠️ Calling ${remotePeerId} with EMPTY stream — video/audio won't flow!`,
    );
  }

  // Add participant placeholder immediately
  if (!useGroupStore.getState().participants.has(remotePeerId)) {
    console.log(
      `[GroupPeer] Adding participant placeholder for ${remotePeerId}`,
    );
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
  }

  // Media call
  console.log(`[GroupPeer] Initiating media call to ${remotePeerId}`);
  const call = peer.call(remotePeerId, stream);
  setupMediaCallHandlers(call, remotePeerId);

  // Data channel — single data connection per peer
  const conn = peer.connect(remotePeerId, {
    reliable: true,
    serialization: "json",
  });
  setupGroupDataConnection(conn);
}

// ─── useGroupCallActions hook ─────────────────────────────────────────────────
export function useGroupCallActions() {
  const groupStore = useGroupStore();

  // Create a new room (just you, waiting for others to join manually)
  const createRoom = useCallback(
    async (displayName?: string) => {
      const peer = usePeerStore.getState().peer;
      const myId = usePeerStore.getState().myId;
      if (!peer || !myId) return;

      groupStore.setGroupStatus("joining");
      if (displayName) groupStore.setMyDisplayName(displayName);

      // Get local media
      let stream: MediaStream;
      try {
        stream = await getBestStream();
        groupStore.setLocalStream(stream);
        groupStore.setHasLocalVideo(stream.getVideoTracks().length > 0);
      } catch (err) {
        console.error("[GroupPeer] Media access failed:", err);
        groupStore.setGroupError("Failed to access camera/microphone.");
        return;
      }

      console.log(
        `[GroupPeer] Local stream acquired — video: ${stream.getVideoTracks().length}, audio: ${stream.getAudioTracks().length}`,
      );

      // Room ID = our own peer ID (simplest approach — share this to join)
      const roomId = myId;
      groupStore.setRoomId(roomId);
      groupStore.setGroupStatus("in-room");
      console.log(`[GroupPeer] ✅ Room created: ${roomId}`);
    },
    [groupStore],
  );

  // Join an existing room by connecting to the room creator's peer ID
  const joinRoom = useCallback(
    async (roomPeerId: string, displayName?: string) => {
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
      let stream: MediaStream;
      try {
        stream = await getBestStream();
        groupStore.setLocalStream(stream);
        groupStore.setHasLocalVideo(stream.getVideoTracks().length > 0);
      } catch (err) {
        console.error("[GroupPeer] Media access failed:", err);
        groupStore.setGroupError("Failed to access camera/microphone.");
        return;
      }

      console.log(
        `[GroupPeer] Local stream acquired — video: ${stream.getVideoTracks().length}, audio: ${stream.getAudioTracks().length}`,
      );

      groupStore.setGroupStatus("in-room");

      // ── FIX: Pass the `stream` local variable directly, NOT `groupStore.localStream`
      // which is a stale closure from the last render. The store was just updated via
      // setLocalStream(stream) but the hook's value won't refresh until re-render.
      connectToPeer(peer, roomPeerId, stream);

      // ── FIX: Do NOT open a second peer.connect() here. The data connection
      // created by connectToPeer() is the single channel for this peer pair.
      // Send the join-room announcement through that same channel once it opens.
      // We poll for the data connection to be ready, then send.
      console.log(
        `[GroupPeer] Polling for data connection to send join-room message to ${roomPeerId}`,
      );
      const announceInterval = setInterval(() => {
        const participant = useGroupStore
          .getState()
          .participants.get(roomPeerId);
        if (participant?.dataConnection) {
          clearInterval(announceInterval);
          const msg: GroupDataMessage = {
            type: "join-room",
            peerId: myId,
            roomId: roomPeerId,
            displayName: displayName || myId.slice(0, 8),
          };
          participant.dataConnection.send(JSON.stringify(msg));
          console.log(
            `[GroupPeer] ✅ Sent join-room announcement to ${roomPeerId}:`,
            msg,
          );
        }
      }, 300);
      // Safety: stop polling after 15 seconds
      setTimeout(() => clearInterval(announceInterval), 15000);

      console.log(`[GroupPeer] Joining room ${roomPeerId}...`);
    },
    [groupStore, createRoom],
  );

  // Invite a specific peer ID into the current room
  const invitePeer = useCallback((remotePeerId: string) => {
    const peer = usePeerStore.getState().peer;
    const gs = useGroupStore.getState();
    if (!peer || gs.groupStatus !== "in-room") return;
    if (gs.participants.has(remotePeerId)) return;

    // Always read the current local stream
    connectToPeer(peer, remotePeerId, gs.localStream);

    // Tell the new peer about all existing participants
    const notifyInterval = setInterval(() => {
      const participant = useGroupStore
        .getState()
        .participants.get(remotePeerId);
      if (participant?.dataConnection) {
        clearInterval(notifyInterval);
        const existingPeerIds = Array.from(
          useGroupStore.getState().participants.keys(),
        );
        const msg: GroupDataMessage = {
          type: "room-peers",
          peers: [usePeerStore.getState().myId, ...existingPeerIds],
          roomId: useGroupStore.getState().roomId,
        };
        participant.dataConnection.send(JSON.stringify(msg));
        console.log(
          `[GroupPeer] Sent peer list to ${remotePeerId}:`,
          existingPeerIds,
        );
      }
    }, 300);
    setTimeout(() => clearInterval(notifyInterval), 15000);
  }, []);

  // Leave room gracefully
  const leaveRoom = useCallback(() => {
    const gs = useGroupStore.getState();
    const myId = usePeerStore.getState().myId;

    // Notify all participants
    gs.participants.forEach((p) => {
      if (p.dataConnection) {
        const msg: GroupDataMessage = { type: "leave-room", peerId: myId };
        try {
          p.dataConnection.send(JSON.stringify(msg));
        } catch {
          /* ignore */
        }
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
    let sentCount = 0;
    gs.participants.forEach((p) => {
      if (p.dataConnection) {
        try {
          p.dataConnection.send(payload);
          sentCount++;
        } catch {
          /* ignore */
        }
      }
    });
    console.log(`[GroupPeer] Chat message broadcast to ${sentCount} peer(s)`);

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
